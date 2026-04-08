terraform {
  required_version = ">= 1.6.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

provider "azurerm" {
  features {}
}

module "container_apps" {
  source = "./modules/container_apps"
}

module "postgres" {
  source = "./modules/postgres"
}

module "redis" {
  source = "./modules/redis"
}

module "storage" {
  source = "./modules/storage"
}

