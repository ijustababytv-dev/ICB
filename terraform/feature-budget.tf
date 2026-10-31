variable "monthly_budget_usd" {
  description = "Console-visible AWS account monthly cost budget; this account-wide guard also includes any non-ICB resources."
  type        = number
  default     = 30
  validation {
    condition     = var.monthly_budget_usd >= 1 && var.monthly_budget_usd <= 10000
    error_message = "Choose a monthly USD budget between 1 and 10000."
  }
}

resource "aws_budgets_budget" "project_guard" {
  count        = var.feature_worker_enabled ? 1 : 0
  name         = "${var.db_identifier}-monthly-cost-guard"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"
  tags         = { Name = "${var.db_identifier}-monthly-cost-guard" }
}
