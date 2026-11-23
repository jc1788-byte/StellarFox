aws_region       = "us-east-1"
environment      = "staging"
environment_short = "stg"

vpc_cidr               = "10.1.0.0/16"
public_subnet_cidrs  = ["10.1.1.0/24", "10.1.2.0/24", "10.1.3.0/24"]
private_subnet_cidrs = ["10.1.11.0/24", "10.1.12.0/24", "10.1.13.0/24"]

kubernetes_version = "1.28"
eks_instance_types = ["t3.medium"]
eks_desired_size   = 2
eks_min_size       = 2
eks_max_size       = 5

db_instance_count        = 2
db_instance_class        = "db.t3.medium"
db_backup_retention_period = 7

redis_node_type = "cache.t3.small"
redis_num_nodes = 2

tags = {
  Environment = "staging"
  CostCenter  = "engineering"
}
