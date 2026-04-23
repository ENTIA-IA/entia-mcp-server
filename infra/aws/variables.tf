variable "project" {
  description = "Project slug used for resource names."
  type        = string
  default     = "entia-mcp"
}

variable "environment" {
  description = "Environment name (e.g. prod)."
  type        = string
  default     = "prod"
}

variable "aws_region" {
  description = "AWS region."
  type        = string
}

variable "vpc_id" {
  description = "VPC id where ECS and ALB run."
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnet ids for ALB."
  type        = list(string)
}

variable "private_subnet_ids" {
  description = "Private subnet ids for ECS tasks."
  type        = list(string)
}

variable "certificate_arn" {
  description = "ACM certificate ARN for HTTPS listener."
  type        = string
}


variable "hosted_zone_id" {
  description = "Route53 hosted zone id for DNS record."
  type        = string
  default     = ""

  validation {
    condition     = var.create_dns_record ? length(trimspace(var.hosted_zone_id)) > 0 : true
    error_message = "hosted_zone_id must be set when create_dns_record=true."
  }
}

variable "domain_name" {
  description = "DNS record for MCP endpoint (e.g. mcp.entia.systems)."
  type        = string
  default     = ""

  validation {
    condition     = var.create_dns_record ? length(trimspace(var.domain_name)) > 0 : true
    error_message = "domain_name must be set when create_dns_record=true."
  }
}

variable "create_dns_record" {
  description = "Whether to create Route53 alias record."
  type        = bool
  default     = false
}

variable "container_image" {
  description = "Container image URI (ECR URI + tag) used by ECS task definition."
  type        = string
}

variable "container_port" {
  description = "MCP server container port."
  type        = number
  default     = 3000
}

variable "task_cpu" {
  description = "ECS task CPU units."
  type        = number
  default     = 512
}

variable "task_memory" {
  description = "ECS task memory (MiB)."
  type        = number
  default     = 1024
}

variable "desired_count" {
  description = "Desired task count in ECS service."
  type        = number
  default     = 2
}

variable "health_check_path" {
  description = "ALB target group health check path."
  type        = string
  default     = "/health"
}

variable "additional_environment" {
  description = "Additional non-secret environment variables passed to the container."
  type        = map(string)
  default     = {}
}

variable "secret_arns" {
  description = "Map of env var names to Secrets Manager secret ARNs."
  type        = map(string)
  default     = {}
}

variable "tags" {
  description = "Tags applied to all resources."
  type        = map(string)
  default     = {}
}
