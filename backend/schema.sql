-- ═══════════════════════════════════════════════════════════
--  گرمابندی ساختمان — ساختار دیتابیس MySQL
--  این فایل را در phpMyAdmin هاست، روی دیتابیس deeppeed_garmabandi
--  از طریق تب Import اجرا کن. جدول‌ها ساخته می‌شوند.
-- ═══════════════════════════════════════════════════════════

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ─── کاربران ───
CREATE TABLE IF NOT EXISTS users (
  id              VARCHAR(40)  NOT NULL PRIMARY KEY,
  phone           VARCHAR(20)  NOT NULL UNIQUE,
  password        VARCHAR(120) NOT NULL,
  firstName       VARCHAR(80)  DEFAULT '',
  lastName        VARCHAR(80)  DEFAULT '',
  isAdmin         TINYINT(1)   NOT NULL DEFAULT 0,
  purchases       LONGTEXT,                       -- JSON array of product ids
  termsAccepted   TINYINT(1)   NOT NULL DEFAULT 0,
  termsAcceptedAt VARCHAR(40)  DEFAULT NULL,
  createdAt       VARCHAR(40)  NOT NULL,
  INDEX idx_users_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── محصولات (شامل پکیج‌ها با type='bundle') ───
CREATE TABLE IF NOT EXISTS products (
  id            VARCHAR(40)  NOT NULL PRIMARY KEY,
  type          VARCHAR(20)  NOT NULL DEFAULT 'book',
  featured      TINYINT(1)   NOT NULL DEFAULT 0,
  title         VARCHAR(255) NOT NULL,
  description   LONGTEXT,
  price         INT          NOT NULL DEFAULT 0,
  originalPrice INT          DEFAULT NULL,
  discount      INT          DEFAULT 0,
  pages         INT          DEFAULT NULL,
  freePages     INT          DEFAULT 0,
  chapterNum    INT          DEFAULT NULL,
  chapters      LONGTEXT,                         -- JSON
  tags          LONGTEXT,                         -- JSON array
  bundleItems   LONGTEXT,                         -- JSON array of product ids (bundles)
  rating        DECIMAL(3,1) DEFAULT 0,
  reviewCount   INT          DEFAULT 0,
  image         LONGTEXT,                         -- /uploads/.. path
  qrPage        VARCHAR(60)  DEFAULT NULL,
  qrCode        VARCHAR(60)  DEFAULT NULL,
  filePath      VARCHAR(255) DEFAULT NULL,        -- server-side path of downloadable file
  fileName      VARCHAR(255) DEFAULT NULL,        -- original filename (extension preserved)
  fileMime      VARCHAR(120) DEFAULT NULL,
  fileSizeMB    DECIMAL(7,1) DEFAULT 0,
  createdAt     VARCHAR(40)  DEFAULT NULL,
  INDEX idx_products_type (type),
  INDEX idx_products_qr (qrPage)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── سفارش‌ها ───
CREATE TABLE IF NOT EXISTS orders (
  id           VARCHAR(40) NOT NULL PRIMARY KEY,
  userId       VARCHAR(40) NOT NULL,
  productId    VARCHAR(40) NOT NULL,
  productTitle VARCHAR(255) DEFAULT '',
  amount       INT         DEFAULT 0,
  status       VARCHAR(20) NOT NULL DEFAULT 'pending',
  paymentRef   VARCHAR(60) DEFAULT NULL,
  createdAt    VARCHAR(40) NOT NULL,
  paidAt       VARCHAR(40) DEFAULT NULL,
  INDEX idx_orders_user (userId),
  INDEX idx_orders_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── نظرات ───
CREATE TABLE IF NOT EXISTS reviews (
  id        VARCHAR(40) NOT NULL PRIMARY KEY,
  productId VARCHAR(40) NOT NULL,
  userId    VARCHAR(40) NOT NULL,
  userName  VARCHAR(160) DEFAULT '',
  rating    INT         DEFAULT 5,
  comment   LONGTEXT,
  createdAt VARCHAR(40) NOT NULL,
  INDEX idx_reviews_product (productId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── تیکت‌های پشتیبانی ───
CREATE TABLE IF NOT EXISTS tickets (
  id          VARCHAR(40)  NOT NULL PRIMARY KEY,
  userId      VARCHAR(40)  NOT NULL,
  userName    VARCHAR(160) DEFAULT '',
  userPhone   VARCHAR(20)  DEFAULT '',
  subject     VARCHAR(160) NOT NULL,
  message     LONGTEXT,
  image       VARCHAR(255) DEFAULT NULL,
  status      VARCHAR(20)  NOT NULL DEFAULT 'pending',
  adminReply  LONGTEXT,
  messages    LONGTEXT,                       -- JSON array: threaded chat messages
  createdAt   VARCHAR(40)  NOT NULL,
  repliedAt   VARCHAR(40)  DEFAULT NULL,
  INDEX idx_tickets_user (userId),
  INDEX idx_tickets_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── مقالات ───
CREATE TABLE IF NOT EXISTS articles (
  id              VARCHAR(40)  NOT NULL PRIMARY KEY,
  title           VARCHAR(255) NOT NULL,
  content         LONGTEXT,
  tags            LONGTEXT,
  relatedProducts LONGTEXT,
  createdAt       VARCHAR(40)  DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
