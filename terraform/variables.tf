variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (dev, staging, production)"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "Environment must be dev, staging, or production."
  }
}

variable "environment_short" {
  description = "Short environment name for resource naming"
  type        = string
  validation {
    condition     = can(regex("^[a-z]{1,3}$", var.environment_short))
    error_message = "Environment short must be 1-3 lowercase letters."
  }
}

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for public subnets"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for private subnets"
  type        = list(string)
  default     = ["10.0.11.0/24", "10.0.12.0/24", "10.0.13.0/24"]
}

variable "kubernetes_version" {
  description = "Kubernetes version for EKS cluster"
  type        = string
  default     = "1.28"
}

variable "eks_instance_types" {
  description = "EC2 instance types for EKS nodes"
  type        = list(string)
  default     = ["t3.medium"]
}

variable "eks_desired_size" {
  description = "Desired number of EKS nodes"
  type        = number
  default     = 2
  validation {
    condition     = var.eks_desired_size >= 1 && var.eks_desired_size <= 100
    error_message = "Desired size must be between 1 and 100."
  }
}

variable "eks_min_size" {
  description = "Minimum number of EKS nodes"
  type        = number
  default     = 1
  validation {
    condition     = var.eks_min_size >= 1
    error_message = "Min size must be at least 1."
  }
}

variable "eks_max_size" {
  description = "Maximum number of EKS nodes"
  type        = number
  default     = 5
  validation {
    condition     = var.eks_max_size >= 1
    error_message = "Max size must be at least 1."
  }
}

variable "db_master_username" {
  description = "Master username for RDS cluster"
  type        = string
  sensitive   = true
  default     = "stellarfox"
}

variable "db_master_password" {
  description = "Master password for RDS cluster"
  type        = string
  sensitive   = true
  validation {
    condition     = length(var.db_master_password) >= 12
    error_message = "Database password must be at least 12 characters."
  }
}

variable "db_instance_count" {
  description = "Number of RDS instances in cluster"
  type        = number
  default     = 2
  validation {
    condition     = var.db_instance_count >= 1 && var.db_instance_count <= 15
    error_message = "Instance count must be between 1 and 15."
  }
}

variable "db_instance_class" {
  description = "Instance class for RDS"
  type        = string
  default     = "db.t3.medium"
}

variable "db_backup_retention_period" {
  description = "Backup retention period in days"
  type        = number
  default     = 7
  validation {
    condition     = var.db_backup_retention_period >= 1 && var.db_backup_retention_period <= 35
    error_message = "Backup retention must be between 1 and 35 days."
  }
}

variable "redis_node_type" {
  description = "ElastiCache node type for Redis"
  type        = string
  default     = "cache.t3.micro"
}

variable "redis_num_nodes" {
  description = "Number of Redis nodes"
  type        = number
  default     = 2
  validation {
    condition     = var.redis_num_nodes >= 1 && var.redis_num_nodes <= 500
    error_message = "Number of nodes must be between 1 and 500."
  }
}

variable "tags" {
  description = "Additional tags to apply to all resources"
  type        = map(string)
  default     = {}
}
