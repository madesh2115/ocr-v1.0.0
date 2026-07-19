-- Subscription System Tables
-- Run this migration to set up subscription functionality

-- Subscription Plans
CREATE TABLE IF NOT EXISTS subscription_plans (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    duration_days INT NOT NULL DEFAULT 30,
    features JSON,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Subscription Orders (payment tracking)
CREATE TABLE IF NOT EXISTS subscription_orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id VARCHAR(100) UNIQUE NOT NULL,
    user_id INT NOT NULL,
    plan_id INT NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    status ENUM('pending', 'completed', 'failed', 'refunded') DEFAULT 'pending',
    gateway VARCHAR(50) DEFAULT 'phonepe',
    payment_id VARCHAR(100),
    failure_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- User Subscriptions
CREATE TABLE IF NOT EXISTS user_subscriptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    plan_id INT NOT NULL,
    status ENUM('active', 'cancelled', 'expired') DEFAULT 'active',
    start_date TIMESTAMP NOT NULL,
    end_date TIMESTAMP NOT NULL,
    payment_id VARCHAR(100),
    gateway VARCHAR(50) DEFAULT 'phonepe',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    cancelled_at TIMESTAMP NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Insert default subscription plans
INSERT INTO subscription_plans (name, description, price, duration_days, features, is_active) VALUES
('Free', 'Basic OCR scanning with limited features', 0.00, 0, '{"scans_per_month": 10, "export_formats": ["pdf"], "cloud_sync": false}', 1),
('Premium', 'Unlimited OCR scanning with all features', 99.00, 30, '{"scans_per_month": -1, "export_formats": ["pdf", "csv", "excel"], "cloud_sync": true, "priority_support": true, "api_access": false}', 1),
('Professional', 'For power users with API access', 299.00, 30, '{"scans_per_month": -1, "export_formats": ["pdf", "csv", "excel", "json"], "cloud_sync": true, "priority_support": true, "api_access": true}', 1);
