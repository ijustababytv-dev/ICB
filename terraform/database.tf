resource "aws_db_parameter_group" "database" {
  name        = "${var.db_identifier}-postgres17"
  family      = "postgres17"
  description = "ICB PostgreSQL 17 with mandatory TLS"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
}

resource "aws_db_instance" "database" {
  identifier = var.db_identifier
  engine     = "postgres"
  # A major-version prefix lets RDS choose its default supported 17.x minor.
  engine_version              = "17"
  instance_class              = "db.t4g.micro"
  multi_az                    = false
  auto_minor_version_upgrade  = true
  allow_major_version_upgrade = false

  db_name                             = "icb"
  username                            = var.db_username
  password_wo                         = var.db_password
  password_wo_version                 = var.db_password_version
  iam_database_authentication_enabled = false
  port                                = 5432

  storage_type          = "gp3"
  allocated_storage     = 20
  max_allocated_storage = 0
  storage_encrypted     = true

  publicly_accessible    = true
  network_type           = "IPV4"
  db_subnet_group_name   = aws_db_subnet_group.database.name
  vpc_security_group_ids = [aws_security_group.database.id]
  parameter_group_name   = aws_db_parameter_group.database.name

  backup_retention_period         = 7
  backup_window                   = "08:00-09:00"
  maintenance_window              = "sun:09:30-sun:10:30"
  copy_tags_to_snapshot           = true
  deletion_protection             = var.deletion_protection
  skip_final_snapshot             = false
  final_snapshot_identifier       = var.final_snapshot_identifier
  delete_automated_backups        = false
  apply_immediately               = false
  monitoring_interval             = 0
  performance_insights_enabled    = false
  enabled_cloudwatch_logs_exports = []
  # Avoid enrolling the database in a paid extended-support lifecycle.
  engine_lifecycle_support = "open-source-rds-extended-support-disabled"

  # Ensure both subnet routes exist before AWS checks public connectivity.
  depends_on = [aws_route_table_association.database]
}
