resource "aws_iam_role" "feature_worker" {
  count = var.feature_worker_enabled ? 1 : 0
  name  = local.feature_name
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "lambda.amazonaws.com" }
  }] })
}

resource "aws_iam_role_policy" "feature_worker" {
  count = var.feature_worker_enabled ? 1 : 0
  name  = "${local.feature_name}-runtime"
  role  = aws_iam_role.feature_worker[0].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.feature_worker[0].arn}:*" },
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = [aws_secretsmanager_secret.activity_database.arn, local.integration_secret_arn] },
    { Effect = "Allow", Action = ["sqs:SendMessage"], Resource = aws_sqs_queue.feature_failures[0].arn }
  ] })
}

resource "aws_iam_role" "feature_scheduler" {
  count = var.feature_worker_enabled ? 1 : 0
  name  = "${local.feature_name}-scheduler"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "scheduler.amazonaws.com" },
    Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id },
    ArnEquals = { "aws:SourceArn" = aws_scheduler_schedule_group.feature_worker[0].arn } }
  }] })
}

resource "aws_iam_role_policy" "feature_scheduler" {
  count = var.feature_worker_enabled ? 1 : 0
  name  = "${local.feature_name}-schedule-target"
  role  = aws_iam_role.feature_scheduler[0].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["lambda:InvokeFunction"], Resource = aws_lambda_function.feature_worker[0].arn },
    { Effect = "Allow", Action = ["sqs:SendMessage"], Resource = aws_sqs_queue.feature_failures[0].arn }
  ] })
}

resource "aws_iam_role_policy" "integration_secrets" {
  name = "${local.activity_name}-integration-secrets"
  role = aws_iam_role.activity_api.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect   = "Allow",
    Action   = ["secretsmanager:CreateSecret", "secretsmanager:DescribeSecret", "secretsmanager:PutSecretValue", "secretsmanager:DeleteSecret", "secretsmanager:RestoreSecret"],
    Resource = local.integration_secret_arn
  }] })
}
