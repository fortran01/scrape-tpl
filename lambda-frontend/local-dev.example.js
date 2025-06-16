const http = require("http");
const url = require("url");
const path = require("path");
const fs = require("fs");

// Load environment variables from .env file if it exists
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  envContent.split("\n").forEach((line) => {
    const [key, value] = line.split("=");
    if (key && value) {
      process.env[key.trim()] = value.trim();
    }
  });
}

// Ensure DATABASE_URL is set
if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL environment variable is not set!");
  console.error(
    "Please set DATABASE_URL in your environment or create a .env file in the parent directory."
  );
  console.error(
    "Example: DATABASE_URL=postgresql://user:password@host:port/database"
  );
  process.exit(1);
}

// Import the handler after setting environment variables
const { handler } = require("./dist/index.js");

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  try {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);

    const parsedUrl = url.parse(req.url, true);

    // Create a mock Lambda event
    const event = {
      requestContext: {
        http: {
          method: req.method,
          path: parsedUrl.pathname,
        },
      },
      queryStringParameters: parsedUrl.query,
      headers: req.headers,
      body: null,
      isBase64Encoded: false,
    };

    // Call the Lambda handler
    const result = await handler(event);

    // Set response headers
    if (result.headers) {
      Object.entries(result.headers).forEach(([key, value]) => {
        res.setHeader(key, value);
      });
    }

    // Set status code and send response
    res.statusCode = result.statusCode || 200;
    res.end(result.body);
  } catch (error) {
    console.error("Server error:", error);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error: "Internal server error",
        message: error.message,
      })
    );
  }
});

server.listen(PORT, () => {
  console.log(
    `🚀 TPL Lambda Frontend running locally at http://localhost:${PORT}`
  );
  console.log(`📊 JSON API available at http://localhost:${PORT}?format=json`);
  console.log(`🗄️ Database: Connected to PostgreSQL`);
  console.log(`\nPress Ctrl+C to stop the server`);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n👋 Shutting down server...");
  server.close(() => {
    console.log("Server stopped");
    process.exit(0);
  });
});
