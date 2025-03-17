-- Create states table
CREATE TABLE IF NOT EXISTS states (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP NULL DEFAULT NULL,
    updated_at TIMESTAMP NULL DEFAULT NULL
);

-- Create districts table
CREATE TABLE IF NOT EXISTS districts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    state_id BIGINT UNSIGNED NOT NULL,
    created_at TIMESTAMP NULL DEFAULT NULL,
    updated_at TIMESTAMP NULL DEFAULT NULL,
    FOREIGN KEY (state_id) REFERENCES states(id)
);

-- Create categories table
CREATE TABLE IF NOT EXISTS categories (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP NULL DEFAULT NULL,
    updated_at TIMESTAMP NULL DEFAULT NULL
);

-- Insert default categories
INSERT INTO categories (id, name, created_at, updated_at) VALUES
(1, 'Supreme Court', NOW(), NOW()),
(2, 'High Courts', NOW(), NOW()),
(3, 'Districts Courts', NOW(), NOW()),
(4, 'Consumer Forums', NOW(), NOW()),
(5, 'Tribunals', NOW(), NOW()),
(6, 'Tax Forums', NOW(), NOW()),
(7, 'Custom Courts', NOW(), NOW());

-- Create courts table
CREATE TABLE IF NOT EXISTS courts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name LONGTEXT NOT NULL,
    state_id BIGINT UNSIGNED NOT NULL,
    district_id BIGINT UNSIGNED NOT NULL,
    category_id BIGINT UNSIGNED NOT NULL,
    created_at TIMESTAMP NULL DEFAULT NULL,
    updated_at TIMESTAMP NULL DEFAULT NULL,
    FOREIGN KEY (state_id) REFERENCES states(id),
    FOREIGN KEY (district_id) REFERENCES districts(id),
    FOREIGN KEY (category_id) REFERENCES categories(id)
);

-- Create court_halls table
CREATE TABLE IF NOT EXISTS court_halls (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    court_id BIGINT UNSIGNED DEFAULT NULL,
    is_display TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NULL DEFAULT NULL,
    updated_at TIMESTAMP NULL DEFAULT NULL,
    FOREIGN KEY (court_id) REFERENCES courts(id)
);

-- Create case_types table
CREATE TABLE IF NOT EXISTS case_types (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    short_form VARCHAR(10),
    expanded_form VARCHAR(100)
);

-- Create litigants table
CREATE TABLE IF NOT EXISTS litigants (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    litigant_name VARCHAR(255)
);

-- Create advocates table
CREATE TABLE IF NOT EXISTS advocates (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    advocate_name VARCHAR(255)
);

-- Create cases table with modified structure
CREATE TABLE IF NOT EXISTS cases (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    cnr_number VARCHAR(50),
    case_type_id BIGINT UNSIGNED,
    filing_number VARCHAR(20),
    filing_date DATE,
    registration_number VARCHAR(20),
    registration_date DATE,
    case_status VARCHAR(100),
    first_hearing_date DATE,
    decision_date DATE,
    disposal_date DATE,
    disposal_nature VARCHAR(255),
    court_hall_id BIGINT UNSIGNED,
    created_at TIMESTAMP NULL DEFAULT NULL,
    updated_at TIMESTAMP NULL DEFAULT NULL,
    FOREIGN KEY (case_type_id) REFERENCES case_types(id),
    FOREIGN KEY (court_hall_id) REFERENCES court_halls(id)
);

-- Create case_litigants table
CREATE TABLE IF NOT EXISTS case_litigants (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    case_id BIGINT UNSIGNED,
    litigant_id BIGINT UNSIGNED,
    advocate_id BIGINT UNSIGNED,
    party_type VARCHAR(50),
    created_at TIMESTAMP NULL DEFAULT NULL,
    updated_at TIMESTAMP NULL DEFAULT NULL,
    FOREIGN KEY (case_id) REFERENCES cases(id),
    FOREIGN KEY (litigant_id) REFERENCES litigants(id),
    FOREIGN KEY (advocate_id) REFERENCES advocates(id)
);

-- Create acts table
CREATE TABLE IF NOT EXISTS acts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NULL DEFAULT NULL,
    updated_at TIMESTAMP NULL DEFAULT NULL,
    UNIQUE KEY unique_act_name (name)
);

-- Create sections table
CREATE TABLE IF NOT EXISTS sections (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    section_number VARCHAR(50)
);

-- Create act_sections table
CREATE TABLE IF NOT EXISTS act_sections (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    act_id BIGINT UNSIGNED NOT NULL,
    section_id BIGINT UNSIGNED NOT NULL,
    created_at TIMESTAMP NULL DEFAULT NULL,
    updated_at TIMESTAMP NULL DEFAULT NULL,
    FOREIGN KEY (act_id) REFERENCES acts(id),
    FOREIGN KEY (section_id) REFERENCES sections(id),
    UNIQUE KEY unique_act_section (act_id, section_id)
);

-- Create case_acts table
CREATE TABLE IF NOT EXISTS case_acts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    case_id BIGINT UNSIGNED NOT NULL,
    act_id BIGINT UNSIGNED NOT NULL,
    created_at TIMESTAMP NULL DEFAULT NULL,
    updated_at TIMESTAMP NULL DEFAULT NULL,
    FOREIGN KEY (case_id) REFERENCES cases(id),
    FOREIGN KEY (act_id) REFERENCES acts(id)
);

-- Create case_history table
CREATE TABLE IF NOT EXISTS case_history (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    case_id BIGINT UNSIGNED,
    judge VARCHAR(255),
    business_date DATE,
    hearing_date DATE,
    purpose TEXT,
    created_at TIMESTAMP NULL DEFAULT NULL,
    updated_at TIMESTAMP NULL DEFAULT NULL,
    FOREIGN KEY (case_id) REFERENCES cases(id)
);

-- Create case_transfers table
CREATE TABLE IF NOT EXISTS case_transfers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    case_id BIGINT UNSIGNED,
    registration_number VARCHAR(20),
    transfer_date DATE,
    from_court VARCHAR(255),
    to_court VARCHAR(255),
    created_at TIMESTAMP NULL DEFAULT NULL,
    updated_at TIMESTAMP NULL DEFAULT NULL,
    FOREIGN KEY (case_id) REFERENCES cases(id)
);

-- Create case_ias table
CREATE TABLE IF NOT EXISTS case_ias (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    case_id BIGINT UNSIGNED NOT NULL,
    ia_no VARCHAR(50) NOT NULL,
    classification VARCHAR(255),
    ia_status VARCHAR(50),
    dt_filing DATE,
    dt_reg DATE,
    ia_party_id BIGINT UNSIGNED,
    status VARCHAR(50),
    party VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (case_id) REFERENCES cases(id),
    FOREIGN KEY (ia_party_id) REFERENCES litigants(id)
);

-- Create failed_cases table
CREATE TABLE IF NOT EXISTS failed_cases (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    cnr_number VARCHAR(20),
    failure_reason VARCHAR(255),
    attempt_count INT DEFAULT 1,
    last_attempt_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create FIR details table
CREATE TABLE IF NOT EXISTS fir_details (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    case_id BIGINT UNSIGNED NOT NULL,
    police_station VARCHAR(255),
    fir_number VARCHAR(50),
    year VARCHAR(4),
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

-- Create judgements table
CREATE TABLE IF NOT EXISTS judgements (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    case_id BIGINT UNSIGNED NOT NULL,
    order_number VARCHAR(50),
    order_date DATE,
    pdf_filename VARCHAR(255),
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);