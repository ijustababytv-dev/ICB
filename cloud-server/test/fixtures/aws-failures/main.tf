terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
}
provider "aws" { region = "us-east-1" }
variable "prefix" {
  type = string
  validation {
    condition     = can(regex("^baby-icb-step2-check-[a-f0-9]{8}$", var.prefix))
    error_message = "Use a generated project-specific verification prefix."
  }
}
variable "worker_role" { type = string }
variable "worker_log_group" { type = string }
variable "queue_arn" { type = string }
variable "environment" { type = map(string) }
variable "release" { type = object({ bucket = string, key = string, version = string, sha256 = string }) }
variable "run_at" { type = string }
data "aws_caller_identity" "current" {}
locals { missing = "arn:aws:lambda:us-east-1:${data.aws_caller_identity.current.account_id}:function:${var.prefix}-missing" }

# Same production handler/package and scoped role; a refused loopback DB connection causes a genuine execution failure.
resource "aws_lambda_function" "accepted_failure" {
  function_name                  = "${var.prefix}-accepted"
  role                           = var.worker_role
  runtime                        = "nodejs22.x"
  architectures                  = ["arm64"]
  handler                        = "src/worker/index.handler"
  memory_size                    = 256
  timeout                        = 15
  reserved_concurrent_executions = 1
  s3_bucket                      = var.release.bucket
  s3_key                         = var.release.key
  s3_object_version              = var.release.version
  source_code_hash               = var.release.sha256
  environment { variables = merge(var.environment, { DB_HOST = "127.0.0.1" }) }
  logging_config {
    log_format = "Text"
    log_group  = var.worker_log_group
  }
  tags = { Name = "${var.prefix}-accepted" }
}
resource "aws_lambda_function_event_invoke_config" "accepted_failure" {
  function_name                = aws_lambda_function.accepted_failure.function_name
  maximum_event_age_in_seconds = 60
  maximum_retry_attempts       = 0
  destination_config {
    on_failure { destination = var.queue_arn }
  }
}
resource "aws_scheduler_schedule_group" "delivery_failure" { name = var.prefix }
resource "aws_iam_role" "delivery_failure" {
  name = "${var.prefix}-scheduler"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect    = "Allow", Action = "sts:AssumeRole", Principal = { Service = "scheduler.amazonaws.com" },
    Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }, ArnEquals = { "aws:SourceArn" = aws_scheduler_schedule_group.delivery_failure.arn } }
  }] })
}
resource "aws_iam_role_policy" "delivery_failure" {
  name = "${var.prefix}-target"
  role = aws_iam_role.delivery_failure.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = "lambda:InvokeFunction", Resource = local.missing },
    { Effect = "Allow", Action = "sqs:SendMessage", Resource = var.queue_arn }
  ] })
}
resource "aws_scheduler_schedule" "delivery_failure" {
  name                = "${var.prefix}-delivery"
  group_name          = aws_scheduler_schedule_group.delivery_failure.name
  schedule_expression = "at(${var.run_at})"
  flexible_time_window { mode = "OFF" }
  target {
    arn      = local.missing
    role_arn = aws_iam_role.delivery_failure.arn
    input    = jsonencode({ version = 1, kind = "delivery-probe", fixture = var.prefix })
    retry_policy {
      maximum_event_age_in_seconds = 60
      maximum_retry_attempts       = 0
    }
    dead_letter_config { arn = var.queue_arn }
  }
  depends_on = [aws_iam_role_policy.delivery_failure]
}
output "failure_function" { value = aws_lambda_function.accepted_failure.function_name }
