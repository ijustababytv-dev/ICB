# Mocked plans/applies make no AWS calls and create no real resources.
mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["us-east-1a", "us-east-1b"] }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_data "aws_partition" {
    defaults = { partition = "aws" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::123456789012:role/activity-api" }
  }
  mock_resource "aws_lambda_function" {
    defaults = {
      arn        = "arn:aws:lambda:us-east-1:123456789012:function:activity-api"
      invoke_arn = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:123456789012:function:activity-api/invocations"
    }
  }
  mock_resource "aws_apigatewayv2_api" {
    defaults = {
      execution_arn = "arn:aws:execute-api:us-east-1:123456789012:fixture"
      api_endpoint  = "https://fixture.execute-api.us-east-1.amazonaws.com"
    }
  }
}

variables {
  db_password          = "TestOnly-NotARealSecret123!"
  activity_db_password = "Fixture-ServicePassword123!"
}

run "foundation_has_no_placeholder_api" {
  command = apply

  assert {
    condition = (
      length(aws_lambda_function.activity_api) == 0 &&
      length(aws_apigatewayv2_route.activity) == 0 &&
      length(aws_secretsmanager_secret_version.activity_database) == 0 &&
      output.activity_api_url == null
    )
    error_message = "Without the real release, keep Lambda/routes disabled and do not invent service credentials."
  }

  assert {
    condition = (
      aws_s3_bucket_public_access_block.activity_artifacts.block_public_acls &&
      aws_s3_bucket_public_access_block.activity_artifacts.block_public_policy &&
      aws_s3_bucket_public_access_block.activity_artifacts.ignore_public_acls &&
      aws_s3_bucket_public_access_block.activity_artifacts.restrict_public_buckets &&
      aws_s3_bucket_versioning.activity_artifacts.versioning_configuration[0].status == "Enabled" &&
      one(one(aws_s3_bucket_server_side_encryption_configuration.activity_artifacts.rule).apply_server_side_encryption_by_default).sse_algorithm == "AES256" &&
      !aws_s3_bucket.activity_artifacts.force_destroy &&
      jsondecode(aws_s3_bucket_policy.activity_artifacts.policy).Statement[0].Effect == "Deny"
    )
    error_message = "Release storage must stay private, encrypted, versioned, TLS-only, and protected from forced deletion."
  }

  assert {
    condition = (
      aws_cloudwatch_log_group.activity_api.retention_in_days == 7 &&
      aws_secretsmanager_secret.activity_database.recovery_window_in_days == 7 &&
      aws_apigatewayv2_api.activity.protocol_type == "HTTP" &&
      aws_apigatewayv2_stage.activity.default_route_settings[0].throttling_rate_limit == 10 &&
      length(aws_apigatewayv2_stage.activity.access_log_settings) == 0
    )
    error_message = "Use bounded logs, secret recovery, HTTP API throttling, and no access-log payload archive."
  }

  assert {
    condition = (
      length(jsondecode(aws_iam_role_policy.activity_api.policy).Statement) == 2 &&
      jsondecode(aws_iam_role_policy.activity_api.policy).Statement[1].Resource == aws_secretsmanager_secret.activity_database.arn &&
      toset(jsondecode(aws_iam_role_policy.activity_api.policy).Statement[1].Action) == toset(["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]) &&
      jsondecode(aws_iam_role_policy.activity_api.policy).Statement[0].Resource == "${aws_cloudwatch_log_group.activity_api.arn}:*"
    )
    error_message = "Runtime permissions must remain scoped to its own log streams and service-role secret."
  }
}

run "enabled_express_lambda" {
  command = apply

  variables {
    activity_api_enabled    = true
    activity_database_ready = true
    activity_db_password    = "Fixture-ServicePassword123!"
    activity_release = {
      key        = "releases/fixture.zip"
      version_id = "mock-immutable-version"
      sha256     = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
    }
  }

  assert {
    condition = (
      aws_lambda_function.activity_api[0].runtime == "nodejs22.x" &&
      aws_lambda_function.activity_api[0].architectures == tolist(["arm64"]) &&
      aws_lambda_function.activity_api[0].handler == "run.sh" &&
      aws_lambda_function.activity_api[0].memory_size == 512 &&
      aws_lambda_function.activity_api[0].timeout == 15 &&
      aws_lambda_function.activity_api[0].reserved_concurrent_executions == 2 &&
      length(aws_lambda_function.activity_api[0].vpc_config) == 0 &&
      aws_lambda_function.activity_api[0].s3_object_version == "mock-immutable-version"
    )
    error_message = "Express must use the pinned, small ARM Lambda deployment outside the VPC, without NAT or provisioned concurrency."
  }

  assert {
    condition = (
      aws_lambda_function.activity_api[0].environment[0].variables["DB_HOST"] == aws_db_instance.database.address &&
      aws_lambda_function.activity_api[0].environment[0].variables["DB_USER"] == "icb_service" &&
      aws_lambda_function.activity_api[0].environment[0].variables["DB_SECRET_ARN"] == aws_secretsmanager_secret.activity_database.arn &&
      aws_lambda_function.activity_api[0].environment[0].variables["AWS_LAMBDA_EXEC_WRAPPER"] == "/opt/bootstrap" &&
      aws_lambda_function.activity_api[0].environment[0].variables["AWS_LWA_READINESS_CHECK_PATH"] == "/healthz" &&
      !contains(keys(aws_lambda_function.activity_api[0].environment[0].variables), "DB_PASSWORD") &&
      aws_secretsmanager_secret_version.activity_database[0].secret_string == null
    )
    error_message = "Wire RDS/adapter configuration automatically; keep passwords out of ordinary environment and secret-string state fields."
  }

  assert {
    condition = (
      aws_apigatewayv2_integration.activity[0].payload_format_version == "2.0" &&
      length(aws_apigatewayv2_route.activity) == 2 &&
      aws_lambda_permission.activity_gateway[0].principal == "apigateway.amazonaws.com" &&
      aws_lambda_permission.activity_gateway[0].source_arn == "${aws_apigatewayv2_api.activity.execution_arn}/*/*" &&
      length(aws_cloudwatch_metric_alarm.activity_api) == 2 &&
      output.activity_api_url == aws_apigatewayv2_api.activity.api_endpoint
    )
    error_message = "Expose the real API through scoped Gateway integration and create its error/throttle alarms."
  }
}

run "block_unprepared_database" {
  command = plan
  variables {
    activity_api_enabled = true
    activity_db_password = "Fixture-ServicePassword123!"
    activity_release = {
      key        = "releases/fixture.zip"
      version_id = "mock-immutable-version"
      sha256     = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
    }
  }
  expect_failures = [aws_lambda_function.activity_api]
}

run "block_missing_release" {
  command = plan
  variables {
    activity_api_enabled    = true
    activity_database_ready = true
    activity_db_password    = "Fixture-ServicePassword123!"
  }
  expect_failures = [aws_lambda_function.activity_api]
}

run "block_missing_service_password" {
  command = plan
  variables {
    activity_api_enabled    = true
    activity_database_ready = true
    activity_db_password    = ""
    activity_release = {
      key        = "releases/fixture.zip"
      version_id = "mock-immutable-version"
      sha256     = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
    }
  }
  expect_failures = [aws_secretsmanager_secret_version.activity_database]
}

run "block_master_role_reuse" {
  command = plan
  variables {
    activity_api_enabled    = true
    activity_database_ready = true
    activity_db_username    = "icbadmin"
    activity_db_password    = "Fixture-ServicePassword123!"
    activity_release = {
      key        = "releases/fixture.zip"
      version_id = "mock-immutable-version"
      sha256     = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
    }
  }
  expect_failures = [aws_lambda_function.activity_api]
}

run "reject_unversioned_or_invalid_release" {
  command = plan
  variables {
    activity_release = {
      key        = "unreviewed/latest.zip"
      version_id = " "
      sha256     = "not-a-base64-sha256"
    }
  }
  expect_failures = [var.activity_release]
}

run "reject_unscoped_alarm_destination" {
  command = plan
  variables {
    alarm_action_arns = ["*"]
  }
  expect_failures = [var.alarm_action_arns]
}
