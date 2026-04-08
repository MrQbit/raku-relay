variable "location" {
  type        = string
  description = "Azure region"
  default     = "Central US"
}

variable "project_name" {
  type        = string
  description = "Base resource prefix"
  default     = "raku-relay"
}

