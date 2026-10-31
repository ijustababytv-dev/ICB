data "aws_availability_zones" "available" {
  state = "available"

  filter {
    name   = "opt-in-status"
    values = ["opt-in-not-required"]
  }
}

resource "aws_vpc" "database" {
  cidr_block           = "10.79.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "${var.db_identifier}-vpc" }
}

resource "aws_internet_gateway" "database" {
  vpc_id = aws_vpc.database.id
  tags   = { Name = "${var.db_identifier}-internet" }
}

# RDS requires subnets in two AZs even though this database is Single-AZ.
resource "aws_subnet" "database" {
  count             = 2
  vpc_id            = aws_vpc.database.id
  cidr_block        = cidrsubnet(aws_vpc.database.cidr_block, 8, count.index)
  availability_zone = data.aws_availability_zones.available.names[count.index]
  tags              = { Name = "${var.db_identifier}-public-${count.index + 1}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.database.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.database.id
  }

  tags = { Name = "${var.db_identifier}-public" }
}

resource "aws_route_table_association" "database" {
  count          = 2
  subnet_id      = aws_subnet.database[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_db_subnet_group" "database" {
  name       = "${var.db_identifier}-subnets"
  subnet_ids = aws_subnet.database[*].id
}

# Internet-wide PostgreSQL access is intentional per the operator's request.
# No inbound rule opens other ports. Security groups allow response traffic.
resource "aws_security_group" "database" {
  name        = "${var.db_identifier}-postgres"
  description = "Public PostgreSQL access on TCP 5432"
  vpc_id      = aws_vpc.database.id

  ingress {
    description = "PostgreSQL clients"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = sort(tolist(var.allowed_ipv4_cidrs))
  }

  tags = { Name = "${var.db_identifier}-postgres" }
}
