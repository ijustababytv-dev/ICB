data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

locals {
  activity_name       = "${substr(var.db_identifier, 0, 40)}-activity-api"
  activity_stage_name = "${substr(var.db_identifier, 0, 40)}-api"
  activity_environment = {
    NODE_ENV                          = "production"
    INTEGRATION_SECRET_PREFIX         = local.integration_secret_prefix
    PORT                              = "8080"
    AWS_LAMBDA_EXEC_WRAPPER           = "/opt/bootstrap"
    AWS_LWA_PORT                      = "8080"
    AWS_LWA_READINESS_CHECK_PATH      = "/healthz"
    AWS_LWA_REMOVE_BASE_PATH          = "/${local.activity_stage_name}"
    RUST_LOG                          = "warn"
    DB_HOST                           = aws_db_instance.database.address
    DB_PORT                           = tostring(aws_db_instance.database.port)
    DB_NAME                           = aws_db_instance.database.db_name
    DB_USER                           = var.activity_db_username
    DB_SECRET_ARN                     = aws_secretsmanager_secret.activity_database.arn
    DB_CA_FILE                        = "/var/task/certs/global-bundle.pem"
    DB_POOL_MAX                       = "1"
    DB_CONNECT_TIMEOUT_MS             = "3000"
    ACTIVITY_MAX_BATCH_RECORDS        = "500"
    ACTIVITY_MAX_BODY_BYTES           = "262144"
    ACTIVITY_SESSION_LIFETIME_SECONDS = "604800"
  }
}

# Only build artifacts belong here; no artwork, live state, or chat archives.
resource "aws_s3_bucket" "activity_artifacts" {
  bucket        = "${substr(var.db_identifier, 0, 16)}-builds-${data.aws_caller_identity.current.account_id}-${var.aws_region}"
  force_destroy = false
}

resource "aws_s3_bucket_public_access_block" "activity_artifacts" {
  bucket                  = aws_s3_bucket.activity_artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "activity_artifacts" {
  bucket = aws_s3_bucket.activity_artifacts.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "activity_artifacts" {
  bucket = aws_s3_bucket.activity_artifacts.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_policy" "activity_artifacts" {
  bucket = aws_s3_bucket.activity_artifacts.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyUnencryptedTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.activity_artifacts.arn, "${aws_s3_bucket.activity_artifacts.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}

resource "aws_secretsmanager_secret" "activity_database" {
  name_prefix             = "${local.activity_name}/database-"
  description             = "ICB limited PostgreSQL service-role login; excludes RDS master credentials"
  recovery_window_in_days = 7
}

# Count uses the non-secret enable switch; ephemeral passwords never enter state.
resource "aws_secretsmanager_secret_version" "activity_database" {
  count                    = var.activity_api_enabled ? 1 : 0
  secret_id                = aws_secretsmanager_secret.activity_database.id
  secret_string_wo         = jsonencode({ username = var.activity_db_username, password = var.activity_db_password })
  secret_string_wo_version = var.activity_db_password_version

  lifecycle {
    precondition {
      condition     = length(var.activity_db_password) >= 16
      error_message = "Supply TF_VAR_activity_db_password for the already-bootstrapped limited database role."
    }
  }
}
