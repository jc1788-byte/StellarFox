aws_region       = "us-east-1"
environment      = "dev"
environment_short = "dev"

vpc_cidr               = "10.0.0.0/16"
public_subnet_cidrs  = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
private_subnet_cidrs = ["10.0.11.0/24", "10.0.12.0/24", "10.0.13.0/24"]

kubernetes_version = "1.28"
eks_instance_types = ["t3.small"]
eks_desired_size   = 1
eks_min_size       = 1
eks_max_size       = 3

db_instance_count        = 1
db_instance_class        = "db.t3.small"
db_backup_retention_period = 1

redis_node_type = "cache.t3.micro"
redis_num_nodes = 1

tags = {
  Environment = "development"
  CostCenter  = "engineering"
}
