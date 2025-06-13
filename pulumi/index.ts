import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as docker from "@pulumi/docker";

// Get configuration values
const config = new pulumi.Config();
const gcpConfig = new pulumi.Config("gcp");
const projectId = gcpConfig.require("project");
const region = gcpConfig.get("region") || "northamerica-northeast2"; // Toronto
const schedulerRegion = "us-central1"; // Cloud Scheduler supported region

// Secret IDs for existing secrets (created by upload-secrets.sh)
const emailUserSecretId = "tpl-scraper-email-user";
const emailPassSecretId = "tpl-scraper-email-pass";
const emailToSecretId = "tpl-scraper-email-to";
const databaseUrlSecretId = "tpl-scraper-database-url";

// Build and push Docker image to Google Container Registry
const imageName = `gcr.io/${projectId}/tpl-scraper`;

const dockerImage = new docker.Image("tpl-scraper-image", {
    imageName: imageName,
    build: {
        context: "../", // Build from the parent directory (project root)
        dockerfile: "../Dockerfile",
        platform: "linux/amd64",
    },
});

// Create a service account for Cloud Run
const serviceAccount = new gcp.serviceaccount.Account("tpl-scraper-sa", {
    accountId: "tpl-scraper",
    displayName: "TPL Scraper Service Account",
});

// Grant necessary permissions to the service account
const secretAccessorBinding = new gcp.projects.IAMBinding("secret-accessor-binding", {
    project: projectId,
    role: "roles/secretmanager.secretAccessor",
    members: [pulumi.interpolate`serviceAccount:${serviceAccount.email}`],
});

// Create Cloud Run job for scheduled execution
const cloudRunJob = new gcp.cloudrunv2.Job("tpl-scraper-job", {
    name: "tpl-scraper",
    location: region,
    template: {
        template: {
            serviceAccount: serviceAccount.email,
            timeout: "3600s", // 1 hour timeout
            containers: [{
                image: dockerImage.imageName,
                resources: {
                    limits: {
                        cpu: "1",
                        memory: "512Mi",
                    },
                },
                envs: [
                    {
                        name: "EMAIL_USER",
                        valueSource: {
                            secretKeyRef: {
                                secret: emailUserSecretId,
                                version: "latest",
                            },
                        },
                    },
                    {
                        name: "EMAIL_PASS",
                        valueSource: {
                            secretKeyRef: {
                                secret: emailPassSecretId,
                                version: "latest",
                            },
                        },
                    },
                    {
                        name: "EMAIL_TO",
                        valueSource: {
                            secretKeyRef: {
                                secret: emailToSecretId,
                                version: "latest",
                            },
                        },
                    },
                    {
                        name: "DATABASE_URL",
                        valueSource: {
                            secretKeyRef: {
                                secret: databaseUrlSecretId,
                                version: "latest",
                            },
                        },
                    },
                    {
                        name: "NODE_ENV",
                        value: "production",
                    },
                ],
            }],
        },
        taskCount: 1,
        parallelism: 1,
    },
});

// Create Cloud Scheduler job to run daily
const schedulerJob = new gcp.cloudscheduler.Job("tpl-scraper-scheduler", {
    name: "tpl-scraper-daily",
    description: "Daily TPL RSS scraper job",
    schedule: "0 9 * * *", // 9 AM UTC daily
    timeZone: "UTC",
    region: schedulerRegion, // Use scheduler-specific region
    httpTarget: {
        uri: pulumi.interpolate`https://${region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${projectId}/jobs/${cloudRunJob.name}:run`,
        httpMethod: "POST",
        oauthToken: {
            serviceAccountEmail: serviceAccount.email,
        },
    },
}, {
    dependsOn: [cloudRunJob, serviceAccount],
});

// Grant Cloud Scheduler permission to invoke Cloud Run
const schedulerInvokerBinding = new gcp.projects.IAMBinding("scheduler-invoker-binding", {
    project: projectId,
    role: "roles/run.invoker",
    members: [pulumi.interpolate`serviceAccount:${serviceAccount.email}`],
});

// Grant Cloud Scheduler permission to create executions
const schedulerExecutorBinding = new gcp.projects.IAMBinding("scheduler-executor-binding", {
    project: projectId,
    role: "roles/cloudscheduler.jobRunner",
    members: [pulumi.interpolate`serviceAccount:${serviceAccount.email}`],
});

// Export important values
export const cloudRunJobName = cloudRunJob.name;
export const schedulerJobName = schedulerJob.name;
export const serviceAccountEmail = serviceAccount.email;
export const dockerImageName = dockerImage.imageName;
export const secretNames = {
    emailUser: emailUserSecretId,
    emailPass: emailPassSecretId,
    emailTo: emailToSecretId,
    databaseUrl: databaseUrlSecretId,
}; 