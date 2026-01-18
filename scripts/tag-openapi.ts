import * as fs from "fs";
import * as path from "path";

interface OpenAPISpec {
  openapi: string;
  info: any;
  servers: any[];
  components: any;
  paths: Record<string, any>;
  tags?: Array<{ name: string; description: string }>;
}

function extractTagFromPath(pathString: string): string {
  // Remove leading slash and split
  const parts = pathString.split("/").filter(Boolean);

  if (parts.length === 0) return "Default";

  // Get first segment and capitalize
  const segment = parts[0];

  // Handle kebab-case and convert to Title Case
  return segment
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function autoTagOpenAPI() {
  const openApiPath = path.join(process.cwd(), "openapi.json");

  // Read the OpenAPI spec
  const spec: OpenAPISpec = JSON.parse(fs.readFileSync(openApiPath, "utf-8"));

  // Track unique tags
  const tagSet = new Set<string>();
  const tagDescriptions: Record<string, string> = {
    Messages: "Message and conversation management endpoints",
    Auth: "Authentication and authorization endpoints",
    User: "User profile and account management endpoints",
    Health: "Health check and monitoring endpoints",
    "Connected Accounts": "Connected account management endpoints",
    Pusher: "Pusher authentication and webhook endpoints",
    Webhooks: "Webhook endpoints for external integrations",
    Memo: "Memo management endpoints for conversations",
  };

  // Process each path
  for (const [pathString, pathItem] of Object.entries(spec.paths)) {
    const tag = extractTagFromPath(pathString);
    tagSet.add(tag);

    // Add tag to each operation in the path
    for (const [method, operation] of Object.entries(pathItem)) {
      if (
        ["get", "post", "put", "patch", "delete", "options", "head"].includes(
          method,
        )
      ) {
        operation.tags = [tag];
      }
    }
  }

  // Create tags array
  spec.tags = Array.from(tagSet)
    .sort()
    .map((tag) => ({
      name: tag,
      description: tagDescriptions[tag] || `${tag} related endpoints`,
    }));

  // Write back to file
  fs.writeFileSync(openApiPath, JSON.stringify(spec, null, 2), "utf-8");

  console.log("✅ OpenAPI spec has been tagged successfully!");
  console.log(`📁 Tags created: ${Array.from(tagSet).join(", ")}`);
}

autoTagOpenAPI();
