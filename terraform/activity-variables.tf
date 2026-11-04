variable "activity_api_enabled" {
  description = "Deploy the real Express Lambda and routes after its release ZIP and database bootstrap are ready."
  type        = bool
  default     = false
}

variable "activity_release" {
  description = "Immutable release ZIP already uploaded to activity_artifact_bucket; sha256 is base64-encoded."
  type = object({
    key        = string
    version_id = string
    sha256     = string
  })
  default = null

  validation {
    condition = var.activity_release == null ? true : (
      can(regex("^releases/.+\\.zip$", var.activity_release.key)) &&
      length(trimspace(var.activity_release.version_id)) > 0 &&
      can(regex("^[A-Za-z0-9+/]{43}=$", var.activity_release.sha256))
    )
    error_message = "Supply a releases/*.zip object key, an immutable S3 version ID, and a base64 SHA-256 digest."
  }
}

variable "activity_database_ready" {
  description = "Set true only after migrations, the limited DB role, grants, and password login have been verified."
  type        = bool
  default     = false
}

variable "activity_db_username" {
  description = "Limited application DB role created by the future migration/bootstrap tool, not the RDS master user."
  type        = string
  default     = "icb_service"

  validation {
    condition     = can(regex("^[a-z][a-z0-9_]{0,62}$", var.activity_db_username))
    error_message = "Use a lowercase PostgreSQL role name, starting with a letter, up to 63 characters."
  }
}

variable "activity_db_password" {
  description = "Password of the bootstrapped service role; write-only secret input required when the API is enabled."
  type        = string
  sensitive   = true
  ephemeral   = true
  nullable    = false
  default     = ""

  validation {
    condition = var.activity_db_password == "" ? true : (
      length(var.activity_db_password) >= 16 && length(var.activity_db_password) <= 128
    )
    error_message = "Use a service-role password of 16-128 characters."
  }
}

variable "activity_db_password_version" {
  description = "Increment after deliberately rotating the service role password in PostgreSQL and the input secret."
  type        = number
  default     = 1

  validation {
    condition     = var.activity_db_password_version >= 1 && floor(var.activity_db_password_version) == var.activity_db_password_version
    error_message = "Password version must be a positive integer."
  }
}

variable "activity_web_adapter_version" {
  description = "Pinned AWS Lambda Web Adapter ARM64 layer release; verify regional availability before deployment."
  type        = number
  default     = 30

  validation {
    condition     = var.activity_web_adapter_version > 0 && floor(var.activity_web_adapter_version) == var.activity_web_adapter_version
    error_message = "Layer version must be a positive integer."
  }
}

variable "alarm_action_arns" {
  description = "Existing SNS topic ARNs for operational alarms; empty means alarms are visible in CloudWatch without notifications."
  type        = set(string)
  default     = []

  validation {
    condition     = alltrue([for arn in var.alarm_action_arns : can(regex("^arn:[^:]+:sns:[^:]+:[0-9]{12}:.+$", arn))])
    error_message = "Alarm destinations must be SNS topic ARNs."
  }
}
