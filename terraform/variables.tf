variable "aws_region" {
  description = "AWS region for the database and its dedicated network."
  type        = string
  default     = "us-east-1"
}

variable "db_identifier" {
  description = "Unique RDS instance identifier and prefix for its network resources."
  type        = string
  default     = "baby-icb"

  validation {
    condition = (
      can(regex("^[a-z][a-z0-9-]{0,53}[a-z0-9]$", var.db_identifier)) &&
      !strcontains(var.db_identifier, "--")
    )
    error_message = "Use 2-55 lowercase letters, digits, or single hyphens, starting with a letter and ending with a letter or digit."
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
      !strcontains(var.final_snapshot_identifier, "--")
    )
    error_message = "Use 2-255 lowercase letters, digits, or single hyphens, starting with a letter and ending with a letter or digit."
  }
}
