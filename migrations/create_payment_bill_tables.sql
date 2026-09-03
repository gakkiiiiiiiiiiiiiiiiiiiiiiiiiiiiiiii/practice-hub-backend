-- Explicit migration only. No schedules, account configuration or payment mutations.
CREATE TABLE IF NOT EXISTS payment_bill (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  account_key VARCHAR(64) NOT NULL,
  channel VARCHAR(10) NOT NULL,
  bill_date DATE NOT NULL,
  status VARCHAR(16) NOT NULL,
  original_gzip LONGBLOB NULL,
  original_size INT NOT NULL DEFAULT 0,
  original_filename VARCHAR(128) NULL,
  sha256 VARCHAR(64) NULL,
  row_count INT NULL,
  preview_supported TINYINT NOT NULL DEFAULT 0,
  notice VARCHAR(500) NULL,
  error_message VARCHAR(255) NULL,
  fetched_at DATETIME NULL,
  retry_after DATETIME NULL,
  attempt_day DATE NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_payment_bill_scope (account_key, channel, bill_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payment_bill_control (
  id INT NOT NULL PRIMARY KEY,
  lease_token VARCHAR(36) NULL,
  lease_until DATETIME NULL,
  budget_day DATE NULL,
  attempt_count INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO payment_bill_control (id, attempt_count) VALUES (1, 0);
