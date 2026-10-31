# Mocked plans exercise infrastructure requirements without AWS access or resources.
mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = {
      names = ["us-east-1a", "us-east-1b"]
    }
  }
}

variables {
  # Public fixture, not an operational credential; this value is never deployed.
  db_password = "TestOnly-NotARealSecret123!"
}

run "small_public_postgres" {
  command = plan

  assert {
    condition = (
      aws_db_instance.database.engine == "postgres" &&
      aws_db_instance.database.engine_version == "17" &&
      aws_db_instance.database.instance_class == "db.t4g.micro" &&
      !aws_db_instance.database.multi_az &&
      aws_db_instance.database.allocated_storage == 20 &&
      aws_db_instance.database.storage_type == "gp3" &&
      aws_db_instance.database.max_allocated_storage == 0 &&
      aws_db_instance.database.monitoring_interval == 0 &&
      !aws_db_instance.database.performance_insights_enabled
    )
    error_message = "Use the agreed micro instance, Single-AZ, 20 GiB gp3, and no paid monitoring/autoscaling."
  }

  assert {
    condition = (
      aws_vpc.database.enable_dns_support && aws_vpc.database.enable_dns_hostnames &&
      length(aws_subnet.database) == 2 &&
      aws_subnet.database[0].availability_zone != aws_subnet.database[1].availability_zone &&
      length(aws_route_table_association.database) == 2 &&
      one(aws_route_table.public.route).cidr_block == "0.0.0.0/0" &&
      aws_db_instance.database.publicly_accessible &&
      aws_db_instance.database.network_type == "IPV4"
    )
    error_message = "Public RDS requires DNS and publicly routed subnets across two AZs."
  }

  assert {
    condition = (
      length(aws_security_group.database.ingress) == 1 &&
      one(aws_security_group.database.ingress).from_port == 5432 &&
      one(aws_security_group.database.ingress).to_port == 5432 &&
      one(aws_security_group.database.ingress).protocol == "tcp" &&
      contains(one(aws_security_group.database.ingress).cidr_blocks, "0.0.0.0/0") &&
      !aws_db_instance.database.iam_database_authentication_enabled &&
      aws_db_instance.database.manage_master_user_password == null &&
      one(aws_db_parameter_group.database.parameter).name == "rds.force_ssl" &&
      one(aws_db_parameter_group.database.parameter).value == "1"
    )
    error_message = "Expose only PostgreSQL with password authentication and mandatory TLS."
  }

  assert {
    condition = (
      aws_db_instance.database.storage_encrypted &&
      aws_db_instance.database.backup_retention_period == 7 &&
      aws_db_instance.database.deletion_protection &&
      !aws_db_instance.database.skip_final_snapshot &&
      !aws_db_instance.database.delete_automated_backups
    )
    error_message = "Keep encryption, backups, deletion protection, and a final snapshot."
  }
}

run "restrict_access_later" {
  command = plan

  variables {
    allowed_ipv4_cidrs = ["203.0.113.10/32"]
  }

  assert {
    condition = (
      length(one(aws_security_group.database.ingress).cidr_blocks) == 1 &&
      contains(one(aws_security_group.database.ingress).cidr_blocks, "203.0.113.10/32")
    )
    error_message = "A CIDR override must replace internet-wide access."
  }
}

run "custom_master_username" {
  command = plan

  variables {
    db_username = "icb_owner"
  }

  assert {
    condition = (
      aws_db_instance.database.username == "icb_owner" &&
      output.database_username == "icb_owner"
    )
    error_message = "The configured username must reach RDS and the connection output."
  }
}

run "reject_invalid_username" {
  command = plan

  variables {
    db_username = "invalid-name"
  }

  expect_failures = [var.db_username]
}

run "maximum_username_length" {
  command = plan

  variables {
    db_username = "a123456789012345"
  }

  assert {
    condition     = aws_db_instance.database.username == "a123456789012345"
    error_message = "A valid 16-character master username must be accepted."
  }
}

run "reject_long_username" {
  command = plan

  variables {
    db_username = "a1234567890123456"
  }

  expect_failures = [var.db_username]
}
