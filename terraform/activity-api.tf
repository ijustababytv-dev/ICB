resource "aws_apigatewayv2_api" "activity" {
  name          = local.activity_name
  protocol_type = "HTTP"
  # Local Node proxies call this API; browser CORS and cloud DB secrets are unnecessary.
}

resource "aws_apigatewayv2_stage" "activity" {
  api_id      = aws_apigatewayv2_api.activity.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit   = 20
    throttling_rate_limit    = 10
    detailed_metrics_enabled = false
  }
}

resource "aws_lambda_function" "activity_api" {
  count                          = var.activity_api_enabled ? 1 : 0
  function_name                  = local.activity_name
  description                    = "ICB authenticated Express activity API"
  role                           = aws_iam_role.activity_api.arn
  runtime                        = "nodejs22.x"
  architectures                  = ["arm64"]
  handler                        = "run.sh"
  memory_size                    = 512
  timeout                        = 15
  reserved_concurrent_executions = 2

  s3_bucket         = aws_s3_bucket.activity_artifacts.id
  s3_key            = var.activity_release == null ? null : var.activity_release.key
  s3_object_version = var.activity_release == null ? null : var.activity_release.version_id
  source_code_hash  = var.activity_release == null ? null : var.activity_release.sha256
  layers = [
    "arn:${data.aws_partition.current.partition}:lambda:${var.aws_region}:753240598075:layer:LambdaAdapterLayerArm64:${var.activity_web_adapter_version}"
  ]

  environment {
    variables = local.activity_environment
  }

  # Intentionally outside the VPC; public RDS TLS access needs no NAT gateway.
  depends_on = [
    aws_iam_role_policy.activity_api,
    aws_cloudwatch_log_group.activity_api,
    aws_secretsmanager_secret_version.activity_database,
    aws_s3_bucket_versioning.activity_artifacts
  ]

  lifecycle {
    precondition {
      condition     = var.activity_release != null
      error_message = "Build and upload the real Step 1 Express ZIP, then supply activity_release with its key, version ID, and SHA-256."
    }
    precondition {
      condition     = var.activity_database_ready && lower(var.activity_db_username) != lower(var.db_username)
      error_message = "Complete and verify DB migrations and a separate limited service role, then set activity_database_ready=true."
    }
  }
}

resource "aws_apigatewayv2_integration" "activity" {
  count                  = var.activity_api_enabled ? 1 : 0
  api_id                 = aws_apigatewayv2_api.activity.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.activity_api[0].invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
  timeout_milliseconds   = 20000
}

resource "aws_apigatewayv2_route" "activity" {
  for_each  = toset(var.activity_api_enabled ? ["ANY /", "ANY /{proxy+}"] : [])
  api_id    = aws_apigatewayv2_api.activity.id
  route_key = each.value
  target    = "integrations/${aws_apigatewayv2_integration.activity[0].id}"
  # Express performs session/owner authorization; only login and readiness are public.
}

resource "aws_lambda_permission" "activity_gateway" {
  count         = var.activity_api_enabled ? 1 : 0
  statement_id  = "AllowOnlyActivityHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.activity_api[0].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.activity.execution_arn}/*/*"
}
