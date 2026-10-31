output "database_host" {
  description = "DNS hostname; use this instead of a public IP that can change."
  value       = aws_db_instance.database.address
}

output "database_port" {
  value = aws_db_instance.database.port
}

output "database_name" {
  value = aws_db_instance.database.db_name
}

output "database_username" {
  value = aws_db_instance.database.username
}

output "psql_command" {
  description = "psql prompts for the password; download the RDS CA bundle first."
  value       = "psql \"host=${aws_db_instance.database.address} port=5432 dbname=icb user=icbadmin sslmode=verify-full sslrootcert=global-bundle.pem\" -W"
}
