-- =====================================================================================
-- Research Lab (VPS) — skema database MySQL 8 / MariaDB 10.6+
-- Isinya sama dengan migrasi CodeIgniter (app/Database/Migrations/2026-11-10-000001_*).
--
-- Cukup pilih SATU cara:
--   a) Otomatis (disarankan): install.sh membuat database dan menjalankan `php spark migrate`.
--   b) Manual: buat database lalu impor file ini, misalnya:
--        mysql -u root -p -e "CREATE DATABASE research_lab CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
--        mysql -u root -p research_lab < research_lab.sql
--      atau lewat phpMyAdmin: pilih database research_lab › Import › file ini.
-- Baris terakhir mencatat migrasi sebagai sudah dijalankan, jadi `php spark migrate` tidak membuat ulang tabel.
-- Akun admin TIDAK dibuat di sini; buat dengan:  php spark rl:admin <username>
-- =====================================================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `users` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username`      VARCHAR(60)  NOT NULL,
  `name`          VARCHAR(120) NOT NULL DEFAULT '',
  `email`         VARCHAR(160) NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `role`          VARCHAR(10)  NOT NULL DEFAULT 'user',      -- admin | user
  `active`        TINYINT(1)   NOT NULL DEFAULT 1,
  `last_login_at` DATETIME NULL,
  `created_at`    DATETIME NULL,
  `updated_at`    DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Proyek penelitian. Kolom data berisi seluruh sesi aplikasi (JSON).
CREATE TABLE IF NOT EXISTS `projects` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_id`   INT UNSIGNED NOT NULL,
  `title`      VARCHAR(400) NOT NULL DEFAULT '',
  `step`       TINYINT(3)   NOT NULL DEFAULT 0,
  `data`       LONGTEXT NULL,
  `version`    INT UNSIGNED NOT NULL DEFAULT 1,
  `updated_by` INT UNSIGNED NULL,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `owner_id` (`owner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Anggota tim per proyek: owner | editor | viewer
CREATE TABLE IF NOT EXISTS `project_members` (
  `project_id` INT UNSIGNED NOT NULL,
  `user_id`    INT UNSIGNED NOT NULL,
  `role`       VARCHAR(10)  NOT NULL DEFAULT 'editor',
  `created_at` DATETIME NULL,
  PRIMARY KEY (`project_id`, `user_id`),
  KEY `user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Riwayat versi (otomatis paling sering tiap 10 menit, maksimal 200 per proyek)
CREATE TABLE IF NOT EXISTS `project_versions` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` INT UNSIGNED NOT NULL,
  `user_id`    INT UNSIGNED NOT NULL,
  `version`    INT UNSIGNED NOT NULL,
  `data`       LONGTEXT NULL,
  `note`       VARCHAR(200) NOT NULL DEFAULT '',
  `created_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `project_id_created_at` (`project_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Kunci Rencana Hasil: sidik jari SHA-256 dan waktu server
CREATE TABLE IF NOT EXISTS `plan_locks` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` INT UNSIGNED NOT NULL,
  `user_id`    INT UNSIGNED NOT NULL,
  `hash`       CHAR(64) NOT NULL,
  `snapshot`   LONGTEXT NULL,
  `locked_at`  DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `project_id` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Gambar hasil analisis (data URL PNG/JPEG)
CREATE TABLE IF NOT EXISTS `project_files` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` INT UNSIGNED NOT NULL,
  `fkey`       VARCHAR(20) NOT NULL,
  `mime`       VARCHAR(40) NOT NULL DEFAULT '',
  `data`       LONGTEXT NULL,
  `size`       INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `project_id_fkey` (`project_id`, `fkey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Log setiap panggilan AI/OpenAlex/.docx (batas pemakaian dan laporan admin)
CREATE TABLE IF NOT EXISTS `ai_logs` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     INT UNSIGNED NOT NULL,
  `project_id`  INT UNSIGNED NULL,
  `endpoint`    VARCHAR(20) NOT NULL,
  `task`        VARCHAR(20) NOT NULL DEFAULT '',
  `model`       VARCHAR(80) NOT NULL DEFAULT '',
  `status`      SMALLINT(5) NOT NULL DEFAULT 0,
  `duration_ms` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at`  DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `user_id_created_at` (`user_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Percobaan login (pembatasan tebak password)
CREATE TABLE IF NOT EXISTS `login_attempts` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ip`         VARCHAR(45) NOT NULL,
  `username`   VARCHAR(60) NOT NULL DEFAULT '',
  `success`    TINYINT(1)  NOT NULL DEFAULT 0,
  `created_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `ip_created_at` (`ip`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Catatan migrasi CodeIgniter (agar `php spark migrate` tidak membuat ulang tabel)
CREATE TABLE IF NOT EXISTS `migrations` (
  `id`        BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
  `version`   VARCHAR(255) NOT NULL,
  `class`     VARCHAR(255) NOT NULL,
  `group`     VARCHAR(255) NOT NULL,
  `namespace` VARCHAR(255) NOT NULL,
  `time`      INT(11) NOT NULL,
  `batch`     INT(11) UNSIGNED NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `migrations` (`version`, `class`, `group`, `namespace`, `time`, `batch`)
SELECT '2026-11-10-000001', 'App\\Database\\Migrations\\CreateResearchLabTables', 'default', 'App', UNIX_TIMESTAMP(), 1
WHERE NOT EXISTS (SELECT 1 FROM `migrations` WHERE `class` = 'App\\Database\\Migrations\\CreateResearchLabTables');
