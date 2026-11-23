aws_region       = "us-east-1"
environment      = "production"
environment_short = "prod"

vpc_cidr               = "10.2.0.0/16"
public_subnet_cidrs  = ["10.2.1.0/24", "10.2.2.0/24", "10.2.3.0/24"]
private_subnet_cidrs = ["10.2.11.0/24", "10.2.12.0/24", "10.2.13.0/24"]

kubernetes_version = "1.28"
eks_instance_types = ["t3.large"]
eks_desired_size   = 3
eks_min_size       = 3
eks_max_size       = 10

db_instance_count        = 3
db_instance_class        = "db.r6i.xlarge"
db_backup_retention_period = 30

redis_node_type = "cache.r6g.xlarge"
redis_num_nodes = 3

tags = {
  Environment = "production"
  CostCenter  = "operations"
  Compliance  = "required"
}
