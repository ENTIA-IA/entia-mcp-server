output "ecr_repository_url" {
  description = "ECR repository URL for the MCP container image."
  value       = aws_ecr_repository.mcp.repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name."
  value       = aws_ecs_cluster.mcp.name
}

output "ecs_service_name" {
  description = "ECS service name."
  value       = aws_ecs_service.mcp.name
}

output "alb_dns_name" {
  description = "ALB DNS name."
  value       = aws_lb.mcp.dns_name
}

output "service_url" {
  description = "Primary MCP URL."
  value       = var.create_dns_record ? "https://${var.domain_name}" : "https://${aws_lb.mcp.dns_name}"
}
