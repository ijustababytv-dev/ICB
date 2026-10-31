output "activity_artifact_bucket" {
  description = "Private, versioned S3 destination for future cloud-server release ZIPs."
  value       = aws_s3_bucket.activity_artifacts.id
}

output "activity_db_secret_arn" {
  description = "Secret reference, not its value; populated when the verified API is enabled."
  value       = aws_secretsmanager_secret.activity_database.arn
}

output "activity_lambda_environment" {
  description = "Non-secret Lambda settings automatically derived from RDS and the service configuration."
  value       = local.activity_environment
}

output "activity_api_url" {
  description = "Local Node cloud API base URL; null until the real Lambda release is enabled."
  value       = var.activity_api_enabled ? "${aws_apigatewayv2_api.activity.api_endpoint}/${aws_apigatewayv2_stage.activity.name}" : null
}

output "activity_infrastructure_status" {
  value = var.activity_api_enabled ? "API deployment configured; verify live application acceptance tests after apply." : "Foundation only. API routes are disabled pending real Express ZIP, database migrations, and service-role bootstrap."
}
