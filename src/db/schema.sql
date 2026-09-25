-- Cake City POS Database Schema
-- PostgreSQL

-- Enums
CREATE TYPE role_type AS ENUM ('owner', 'cashier', 'chef', 'inventory');
CREATE TYPE order_status AS ENUM ('ordered', 'in_progress', 'ready', 'collected', 'cancelled');
CREATE TYPE payment_method AS ENUM ('cash', 'mpesa', 'tigopesa', 'airtel_money');
CREATE TYPE adjustment_type AS ENUM ('restock', 'waste');

-- Staff accounts (Mtumiaji)
CREATE TABLE mtumiaji (
  id SERIAL PRIMARY KEY,
  jina VARCHAR(100) NOT NULL,
  jukumu role_type NOT NULL,
  pin_hash VARCHAR(255) NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Products (Bidhaa)
CREATE TABLE bidhaa (
  id SERIAL PRIMARY KEY,
  jina VARCHAR(200) NOT NULL,
  bei DECIMAL(10,2) NOT NULL,
  aina VARCHAR(100),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Customers (Mteja)
CREATE TABLE mteja (
  id SERIAL PRIMARY KEY,
  jina VARCHAR(200) NOT NULL,
  simu VARCHAR(20),
  siku_ya_kuzaliwa DATE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Custom orders (Agizo Maalum)
CREATE TABLE agizo_maalum (
  id SERIAL PRIMARY KEY,
  mteja_id INTEGER REFERENCES mteja(id),
  ladha VARCHAR(200) NOT NULL,
  design TEXT,
  ukubwa VARCHAR(50),
  tarehe_ya_kuchukua DATE NOT NULL,
  bei_jumla DECIMAL(10,2) NOT NULL,
  malipo_ya_awali DECIMAL(10,2) DEFAULT 0,
  salio DECIMAL(10,2) GENERATED ALWAYS AS (bei_jumla - malipo_ya_awali) STORED,
  hali order_status DEFAULT 'ordered',
  created_by INTEGER REFERENCES mtumiaji(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Stock (Malighafi/Hisa)
CREATE TABLE malighafi (
  id SERIAL PRIMARY KEY,
  jina VARCHAR(200) NOT NULL,
  kiasi_kilichopo DECIMAL(10,2) DEFAULT 0,
  kiwango_cha_chini DECIMAL(10,2) DEFAULT 0,
  unit VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Sales (Mauzo)
CREATE TABLE mauzo (
  id SERIAL PRIMARY KEY,
  tarehe DATE DEFAULT CURRENT_DATE,
  mfanyakazi_id INTEGER REFERENCES mtumiaji(id),
  jumla DECIMAL(10,2) NOT NULL,
  njia_ya_malipo payment_method NOT NULL,
  risiti_no VARCHAR(50) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Sale line items (Mauzo Bidhaa)
CREATE TABLE mauzo_bidhaa (
  id SERIAL PRIMARY KEY,
  mauzo_id INTEGER REFERENCES mauzo(id) ON DELETE CASCADE,
  bidhaa_id INTEGER REFERENCES bidhaa(id),
  kiasi INTEGER NOT NULL DEFAULT 1,
  bei DECIMAL(10,2) NOT NULL
);

-- ── Ticketing system (Tikiti) ────────────────────────────────────────
-- Per-day sequential ticket counter. One row per day; namba incremented
-- atomically inside the sale/order transaction. Resets naturally daily.
CREATE TABLE mlolongo_wa_tikiti (
  tarehe DATE PRIMARY KEY,
  namba INTEGER NOT NULL DEFAULT 0
);

CREATE TYPE tikiti_aina AS ENUM ('mauzo', 'agizo');
CREATE TYPE tikiti_hali AS ENUM ('in_queue', 'preparing', 'ready', 'collected', 'cancelled');

-- A ticket is the customer-facing claim: a daily sequential number
-- attached to either a counter sale (mauzo) or a custom order (agizo).
CREATE TABLE tikiti (
  id SERIAL PRIMARY KEY,
  namba INTEGER NOT NULL,
  tarehe DATE NOT NULL DEFAULT CURRENT_DATE,
  aina tikiti_aina NOT NULL,
  hali tikiti_hali NOT NULL DEFAULT 'in_queue',
  mauzo_id INTEGER REFERENCES mauzo(id),
  agizo_id INTEGER REFERENCES agizo_maalum(id),
  jina VARCHAR(200),
  maelezo TEXT,
  jumla DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tarehe, namba)
);

CREATE INDEX idx_tikiti_hali ON tikiti(hali);
CREATE INDEX idx_tikiti_mauzo ON tikiti(mauzo_id);
CREATE INDEX idx_tikiti_agizo ON tikiti(agizo_id);

-- Usage logs (Kumbukumbu ya Matumizi) - Chef logs per order
CREATE TABLE kumbukumbu_matumizi (
  id SERIAL PRIMARY KEY,
  agizo_id INTEGER REFERENCES agizo_maalum(id),
  malighafi_id INTEGER REFERENCES malighafi(id),
  kiasi DECIMAL(10,2) NOT NULL,
  mpishi_id INTEGER REFERENCES mtumiaji(id),
  tarehe TIMESTAMP DEFAULT NOW()
);

-- Stock adjustments (Kujaza Upya / Upotevu)
CREATE TABLE marekebisho_hisa (
  id SERIAL PRIMARY KEY,
  malighafi_id INTEGER REFERENCES malighafi(id),
  aina adjustment_type NOT NULL,
  kiasi DECIMAL(10,2) NOT NULL,
  sababu TEXT,
  created_by INTEGER REFERENCES mtumiaji(id),
  tarehe TIMESTAMP DEFAULT NOW()
);

-- Prep-time config (muda wa kazi kwa ukubwa wa keki)
CREATE TABLE muda_wa_kazi (
  id SERIAL PRIMARY KEY,
  ukubwa VARCHAR(50) UNIQUE NOT NULL,
  dakika INTEGER NOT NULL DEFAULT 90,
  updated_by INTEGER REFERENCES mtumiaji(id)
);

-- ── Append-only audit trail (Kumbukumbu ya Kitendo) ──────────────────
-- Immutable record of every business-data change. Written by DB triggers
-- in the SAME transaction as the change, so a record can never be lost or
-- diverge from the source row. Only a DB administrator (manual SQL) should
-- ever DELETE from this table — the application exposes it read-only.
CREATE TABLE kumbukumbu_kitendo (
  id SERIAL PRIMARY KEY,
  tarehe TIMESTAMP DEFAULT NOW(),
  meza TEXT NOT NULL,          -- table name (e.g. mauzo, tikiti)
  kitendo TEXT NOT NULL,       -- INSERT | UPDATE | DELETE
  node_id INTEGER,             -- affected row id
  data_ya_kabla JSONB,         -- snapshot before (UPDATE/DELETE)
  data_ya_baada JSONB          -- snapshot after (INSERT/UPDATE)
);

CREATE INDEX idx_kitendo_meza ON kumbukumbu_kitendo(meza, tarehe);
CREATE INDEX idx_kitendo_node ON kumbukumbu_kitendo(node_id);

-- Generic audit trigger: snapshots OLD/NEW rows; strips the staff PIN hash.
CREATE OR REPLACE FUNCTION fn_audit_kitendo() RETURNS TRIGGER AS $$
DECLARE
  kabla JSONB;
  baada JSONB;
BEGIN
  IF TG_TABLE_NAME = 'mtumiaji' THEN
    kabla := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) - 'pin_hash' ELSE NULL END;
    baada := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) - 'pin_hash' ELSE NULL END;
  ELSE
    kabla := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END;
    baada := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END;
  END IF;

  INSERT INTO kumbukumbu_kitendo (meza, kitendo, node_id, data_ya_kabla, data_ya_baada)
  VALUES (TG_TABLE_NAME, TG_OP, COALESCE((NEW).id, (OLD).id), kabla, baada);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Attach to every business record — finances, products, staff, tickets.
CREATE TRIGGER audit_mauzo        AFTER INSERT OR UPDATE OR DELETE ON mauzo
  FOR EACH ROW EXECUTE FUNCTION fn_audit_kitendo();
CREATE TRIGGER audit_mauzo_bidhaa AFTER INSERT OR UPDATE OR DELETE ON mauzo_bidhaa
  FOR EACH ROW EXECUTE FUNCTION fn_audit_kitendo();
CREATE TRIGGER audit_agizo        AFTER INSERT OR UPDATE OR DELETE ON agizo_maalum
  FOR EACH ROW EXECUTE FUNCTION fn_audit_kitendo();
CREATE TRIGGER audit_tikiti       AFTER INSERT OR UPDATE OR DELETE ON tikiti
  FOR EACH ROW EXECUTE FUNCTION fn_audit_kitendo();
CREATE TRIGGER audit_kumbukumbu   AFTER INSERT OR UPDATE OR DELETE ON kumbukumbu_matumizi
  FOR EACH ROW EXECUTE FUNCTION fn_audit_kitendo();
CREATE TRIGGER audit_marekebisho  AFTER INSERT OR UPDATE OR DELETE ON marekebisho_hisa
  FOR EACH ROW EXECUTE FUNCTION fn_audit_kitendo();
CREATE TRIGGER audit_mtumiaji     AFTER INSERT OR UPDATE OR DELETE ON mtumiaji
  FOR EACH ROW EXECUTE FUNCTION fn_audit_kitendo();
CREATE TRIGGER audit_bidhaa       AFTER INSERT OR UPDATE OR DELETE ON bidhaa
  FOR EACH ROW EXECUTE FUNCTION fn_audit_kitendo();
CREATE TRIGGER audit_malighafi    AFTER INSERT OR UPDATE OR DELETE ON malighafi
  FOR EACH ROW EXECUTE FUNCTION fn_audit_kitendo();
CREATE TRIGGER audit_mteja        AFTER INSERT OR UPDATE OR DELETE ON mteja
  FOR EACH ROW EXECUTE FUNCTION fn_audit_kitendo();

-- Reminders (Mfumo wa Ukumbusho)
CREATE TYPE reminder_kind AS ENUM (
  'anza_kutengeneza',    -- chef: start baking now, predicted by prep time
  'tarehe_ya_kuchukua',  -- cashier: pickup approaching / today
  'hisa_itakosa',        -- inventory/owner: stock predicted to deplete
  'hisa_chini'           -- inventory: below reorder point
);

CREATE TABLE ukumbusho (
  id SERIAL PRIMARY KEY,
  aina reminder_kind NOT NULL,
  lengo role_type NOT NULL,           -- target role (department)
  agizo_id INTEGER REFERENCES agizo_maalum(id),
  malighafi_id INTEGER REFERENCES malighafi(id),
  ujumbe TEXT NOT NULL,
  tarehe_ya_utekelezaji DATE,          -- actionable due date
  muda_inayopendekezwa TIMESTAMP,       -- e.g. start-by for anza_kutengeneza
  imesomwa BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
UNIQUE (aina, agizo_id, malighafi_id, lengo)
  );

  CREATE UNIQUE INDEX ukumbusho_dedupe_idx
    ON ukumbusho (aina, lengo, COALESCE(agizo_id, 0), COALESCE(malighafi_id, 0));

-- Indexes for performance
CREATE INDEX idx_agizo_hali ON agizo_maalum(hali);
CREATE INDEX idx_agizo_tarehe ON agizo_maalum(tarehe_ya_kuchukua);
CREATE INDEX idx_mauzo_tarehe ON mauzo(tarehe);
CREATE INDEX idx_mauzo_mfanyakazi ON mauzo(mfanyakazi_id);
CREATE INDEX idx_kumbukumbu_agizo ON kumbukumbu_matumizi(agizo_id);
CREATE INDEX idx_kumbukumbu_malighafi ON kumbukumbu_matumizi(malighafi_id);

-- Trigger: auto-decrement stock when usage logged
CREATE OR REPLACE FUNCTION update_stock_from_usage()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE malighafi
  SET kiasi_kilichopo = kiasi_kilichopo - NEW.kiasi
  WHERE id = NEW.malighafi_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_usage_decrement_stock
  AFTER INSERT ON kumbukumbu_matumizi
  FOR EACH ROW
  EXECUTE FUNCTION update_stock_from_usage();
