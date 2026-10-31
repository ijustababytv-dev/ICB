variable "aws_region" {
  description = "AWS region for the database and its dedicated network."
  type        = string
  default     = "us-east-1"
}

variable "db_identifier" {
  description = "Unique RDS identifier and base for resource names; must start with baby-icb-."
  type        = string
  default     = "baby-icb-postgres"

  validation {
    condition = (
      can(regex("^[a-z][a-z0-9-]{0,53}[a-z0-9]$", var.db_identifier)) &&
      !strcontains(var.db_identifier, "--") && startswith(var.db_identifier, "baby-icb-")
    )
    error_message = "Start with baby-icb-, use at most 55 lowercase letters/digits/single hyphens, and end with a letter or digit."
  }
}

variable "db_username" {
  description = "RDS master username, supplied with TF_VAR_db_username if desired. Changing it replaces an existing database."
  type        = string
  default     = "icbadmin"

  validation {
    condition     = can(regex("^[A-Za-z][A-Za-z0-9_]{0,15}$", var.db_username))
    error_message = "Use 1-16 letters, digits, or underscores, beginning with a letter. AWS also rejects database-reserved names."
  }
}

variable "db_password" {
  description = "Master password from a private prompt or TF_VAR_db_password; never stored in Terraform state."
  type        = string
  sensitive   = true
  ephemeral   = true

  validation {
    condition = (
      length(var.db_password) >= 16 && length(var.db_password) <= 128 &&
      can(regex("^[!-~]+$", var.db_password)) &&
      length(regexall("[/@\"]", var.db_password)) == 0
    )
    error_message = "Use 16-128 printable ASCII characters without spaces, /, @, or double quotes."
  }
}

variable "db_password_version" {
  description = "Increment when rotating db_password; a changed secret alone does not trigger an update."
  type        = number
  default     = 1

  validation {
    condition     = var.db_password_version >= 1 && floor(var.db_password_version) == var.db_password_version
    error_message = "Password version must be a positive integer."
  }
}

variable "allowed_ipv4_cidrs" {
  description = "Sources allowed on TCP 5432. Internet-wide access is the requested default."
  type        = set(string)
  default     = ["0.0.0.0/0"]

  validation {
    condition     = length(var.allowed_ipv4_cidrs) > 0 && alltrue([for cidr in var.allowed_ipv4_cidrs : can(cidrnetmask(cidr))])
    error_message = "Supply at least one valid IPv4 CIDR, such as 0.0.0.0/0 or your public IP with /32."
  }
}

variable "deletion_protection" {
  description = "Keep enabled normally; disable and apply separately before deliberate destruction."
  type        = bool
  default     = true
}

variable "final_snapshot_identifier" {
  description = "Unused snapshot name for a deliberate destruction; change before deleting a replacement instance."
  type        = string
  default     = "baby-icb-final"

  validation {
    condition = (
      can(regex("^[a-z][a-z0-9-]{0,253}[a-z0-9]$", var.final_snapshot_identifier)) &&
      !strcontains(var.final_snapshot_identifier, "--") && startswith(var.final_snapshot_identifier, "baby-icb-")
    )
    error_message = "Start with baby-icb-, use at most 255 lowercase letters/digits/single hyphens, and end with a letter or digit."
  }
}
