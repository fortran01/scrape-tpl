#!/bin/bash

# TPL Lambda Frontend Deployment Script
# This script builds and deploys the Lambda function to AWS with Function URL

set -e  # Exit on any error

echo "🚀 TPL Lambda Frontend Deployment"
echo "=================================="
echo ""

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI is not installed. Please install it first."
    echo "   https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
    exit 1
fi

# Check if AWS credentials are configured
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ AWS credentials not configured. Please run 'aws configure' first."
    exit 1
fi

# Check if required environment variables are set
if [ -z "$DATABASE_URL" ]; then
    echo "❌ DATABASE_URL environment variable is required"
    echo "   Please set it with: export DATABASE_URL='postgresql://...'"
    exit 1
fi

# Configuration
FUNCTION_NAME="${FUNCTION_NAME:-tpl-frontend}"
REGION="${AWS_REGION:-us-east-1}"
MEMORY_SIZE="${MEMORY_SIZE:-128}"
TIMEOUT="${TIMEOUT:-30}"

echo "📋 Configuration:"
echo "   Function Name: $FUNCTION_NAME"
echo "   Region: $REGION"
echo "   Memory: ${MEMORY_SIZE}MB"
echo "   Timeout: ${TIMEOUT}s"
echo ""

# Function to wait for Lambda function to be ready
wait_for_function_ready() {
    local max_attempts=30
    local attempt=1
    
    echo "⏳ Waiting for function to be ready..."
    
    while [ $attempt -le $max_attempts ]; do
        local state=$(aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" --query 'Configuration.State' --output text 2>/dev/null || echo "NotFound")
        local last_update_status=$(aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" --query 'Configuration.LastUpdateStatus' --output text 2>/dev/null || echo "NotFound")
        
        if [ "$state" = "Active" ] && [ "$last_update_status" = "Successful" ]; then
            echo "✅ Function is ready"
            return 0
        elif [ "$state" = "Failed" ] || [ "$last_update_status" = "Failed" ]; then
            echo "❌ Function update failed"
            return 1
        fi
        
        echo "   Attempt $attempt/$max_attempts - State: $state, Status: $last_update_status"
        sleep 10
        ((attempt++))
    done
    
    echo "❌ Timeout waiting for function to be ready"
    return 1
}

# Build the function
echo "🔨 Building Lambda function..."
npm run build

if [ ! -f "dist/index.js" ]; then
    echo "❌ Build failed - dist/index.js not found"
    exit 1
fi

echo "✅ Build completed successfully"

# Create deployment package
echo "📦 Creating deployment package..."
rm -f lambda-function.zip

# Create a temporary directory for packaging
TEMP_DIR=$(mktemp -d)
cp -r dist/ "$TEMP_DIR/"
cp -r node_modules/ "$TEMP_DIR/"
cp package.json "$TEMP_DIR/"

# Create zip from temp directory
cd "$TEMP_DIR"
zip -r lambda-function.zip . > /dev/null
cd - > /dev/null

# Move zip to current directory
mv "$TEMP_DIR/lambda-function.zip" .
rm -rf "$TEMP_DIR"

PACKAGE_SIZE=$(du -h lambda-function.zip | cut -f1)
echo "✅ Package created: lambda-function.zip ($PACKAGE_SIZE)"

# Check if function exists
echo "🔍 Checking if function exists..."
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" &> /dev/null; then
    echo "📝 Function exists, updating code..."
    
    # Wait for function to be ready before updating
    if ! wait_for_function_ready; then
        echo "❌ Function is not ready for updates"
        exit 1
    fi
    
    # Update function code with retry logic
    update_attempts=3
    update_attempt=1
    
    while [ $update_attempt -le $update_attempts ]; do
        echo "   Code update attempt $update_attempt/$update_attempts..."
        
        if aws lambda update-function-code \
            --function-name "$FUNCTION_NAME" \
            --zip-file fileb://lambda-function.zip \
            --region "$REGION" > /dev/null 2>&1; then
            echo "✅ Code updated successfully"
            break
        else
            if [ $update_attempt -eq $update_attempts ]; then
                echo "❌ Failed to update function code after $update_attempts attempts"
                exit 1
            fi
            echo "   Update failed, waiting before retry..."
            sleep 15
            ((update_attempt++))
        fi
    done
    
    # Wait for code update to complete
    if ! wait_for_function_ready; then
        echo "❌ Code update did not complete successfully"
        exit 1
    fi
    
    echo "⚙️ Updating configuration..."
    
    # Update configuration with retry logic
    config_attempts=3
    config_attempt=1
    
    while [ $config_attempt -le $config_attempts ]; do
        echo "   Configuration update attempt $config_attempt/$config_attempts..."
        
        if aws lambda update-function-configuration \
            --function-name "$FUNCTION_NAME" \
            --memory-size "$MEMORY_SIZE" \
            --timeout "$TIMEOUT" \
            --environment Variables="{DATABASE_URL=$DATABASE_URL}" \
            --region "$REGION" > /dev/null 2>&1; then
            echo "✅ Configuration updated successfully"
            break
        else
            if [ $config_attempt -eq $config_attempts ]; then
                echo "⚠️ Configuration update failed, but code was updated successfully"
                break
            fi
            echo "   Configuration update failed, waiting before retry..."
            sleep 15
            ((config_attempt++))
        fi
    done
    
    echo "✅ Function updated successfully"
else
    echo "🆕 Function doesn't exist, creating new function..."
    
    # Check if execution role exists
    ROLE_NAME="lambda-execution-role"
    if ! aws iam get-role --role-name "$ROLE_NAME" &> /dev/null; then
        echo "🔐 Creating IAM execution role..."
        
        # Create trust policy
        cat > trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF
        
        aws iam create-role \
            --role-name "$ROLE_NAME" \
            --assume-role-policy-document file://trust-policy.json > /dev/null
        
        aws iam attach-role-policy \
            --role-name "$ROLE_NAME" \
            --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
        
        rm trust-policy.json
        echo "✅ IAM role created"
        
        # Wait for role to be available
        echo "⏳ Waiting for IAM role to be available..."
        sleep 10
    fi
    
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"
    
    aws lambda create-function \
        --function-name "$FUNCTION_NAME" \
        --runtime nodejs20.x \
        --role "$ROLE_ARN" \
        --handler index.handler \
        --zip-file fileb://lambda-function.zip \
        --memory-size "$MEMORY_SIZE" \
        --timeout "$TIMEOUT" \
        --environment Variables="{DATABASE_URL=$DATABASE_URL}" \
        --region "$REGION" > /dev/null
    
    echo "✅ Function created successfully"
fi

# Wait for final function state
if ! wait_for_function_ready; then
    echo "❌ Function deployment did not complete successfully"
    exit 1
fi

# Create or update Function URL
echo "🌐 Setting up Lambda Function URL..."
if aws lambda get-function-url-config --function-name "$FUNCTION_NAME" --region "$REGION" &> /dev/null; then
    echo "📝 Function URL already exists"
    FUNCTION_URL=$(aws lambda get-function-url-config --function-name "$FUNCTION_NAME" --region "$REGION" --query FunctionUrl --output text)
else
    echo "🆕 Creating Function URL..."
    FUNCTION_URL=$(aws lambda create-function-url-config \
        --function-name "$FUNCTION_NAME" \
        --auth-type NONE \
        --cors '{
            "AllowCredentials": false,
            "AllowHeaders": ["date", "keep-alive"],
            "AllowMethods": ["*"],
            "AllowOrigins": ["*"],
            "ExposeHeaders": ["date", "keep-alive"],
            "MaxAge": 86400
        }' \
        --region "$REGION" \
        --query FunctionUrl --output text)
    echo "✅ Function URL created"
fi

# Add Function URL permission for public access
echo "🔐 Setting up Function URL permissions..."
if aws lambda get-policy --function-name "$FUNCTION_NAME" --region "$REGION" &> /dev/null; then
    # Check if the specific permission already exists
    if aws lambda get-policy --function-name "$FUNCTION_NAME" --region "$REGION" --query 'Policy' --output text | grep -q "FunctionURLAllowPublicAccess"; then
        echo "📝 Function URL permission already exists"
    else
        echo "🆕 Adding Function URL permission..."
        aws lambda add-permission \
            --function-name "$FUNCTION_NAME" \
            --region "$REGION" \
            --statement-id FunctionURLAllowPublicAccess \
            --action lambda:InvokeFunctionUrl \
            --principal "*" \
            --function-url-auth-type NONE > /dev/null
        echo "✅ Function URL permission added"
    fi
else
    echo "🆕 Adding Function URL permission..."
    aws lambda add-permission \
        --function-name "$FUNCTION_NAME" \
        --region "$REGION" \
        --statement-id FunctionURLAllowPublicAccess \
        --action lambda:InvokeFunctionUrl \
        --principal "*" \
        --function-url-auth-type NONE > /dev/null
    echo "✅ Function URL permission added"
fi

# Get function info
FUNCTION_ARN=$(aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" --query Configuration.FunctionArn --output text)

echo ""
echo "🎉 Deployment completed successfully!"
echo ""
echo "📋 Function Details:"
echo "   Name: $FUNCTION_NAME"
echo "   ARN: $FUNCTION_ARN"
echo "   Region: $REGION"
echo "   Function URL: $FUNCTION_URL"
echo ""
echo "🌐 Access your TPL Events frontend:"
echo "   HTML: $FUNCTION_URL"
echo "   JSON: ${FUNCTION_URL}?format=json"
echo ""
echo "🔗 Next Steps:"
echo "   1. Visit the Function URL to see your TPL events"
echo "   2. Configure custom domain (optional)"
echo "   3. Set up CloudWatch monitoring"
echo ""
echo "💡 Test the function:"
echo "   curl $FUNCTION_URL"
echo ""

# Clean up
rm -f lambda-function.zip

echo "✨ Deployment script completed!" 