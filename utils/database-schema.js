"use strict";

async function initializeDatabaseSchema(pool) {
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("A database pool is required.");
  }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_emails (
        id BIGSERIAL PRIMARY KEY,
        resend_email_id TEXT UNIQUE,
        message_id TEXT NOT NULL DEFAULT '',
        references_header TEXT NOT NULL DEFAULT '',
        direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
        from_address TEXT NOT NULL DEFAULT '',
        to_addresses JSONB NOT NULL DEFAULT '[]'::jsonb,
        subject TEXT NOT NULL DEFAULT '',
        text_body TEXT NOT NULL DEFAULT '',
        html_body TEXT NOT NULL DEFAULT '',
        is_read BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS admin_emails_created_idx ON admin_emails(created_at DESC);
      CREATE INDEX IF NOT EXISTS admin_emails_inbox_idx ON admin_emails(direction,is_read,created_at DESC);
    `);
    await pool.query(`ALTER TABLE admin_emails ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb`);
    await pool.query(`ALTER TABLE admin_emails ADD COLUMN IF NOT EXISTS message_id TEXT NOT NULL DEFAULT ''`);
    await pool.query(`ALTER TABLE admin_emails ADD COLUMN IF NOT EXISTS references_header TEXT NOT NULL DEFAULT ''`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS device_register (
        id BIGSERIAL PRIMARY KEY,
        device_type TEXT NOT NULL CHECK (device_type IN ('customer_repair','commercial')),
        identifier_type TEXT NOT NULL CHECK (identifier_type IN ('imei','serial','barcode')),
        identifier_value TEXT NOT NULL,
        model TEXT NOT NULL,
        brand TEXT NOT NULL DEFAULT 'Apple',
        status TEXT NOT NULL,
        customer_name TEXT NOT NULL DEFAULT '',
        customer_phone TEXT NOT NULL DEFAULT '',
        customer_email TEXT NOT NULL DEFAULT '',
        repair_order_number TEXT NOT NULL DEFAULT '',
        purchase_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
        sale_price NUMERIC(12,2) NOT NULL DEFAULT 0,
        archived BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(identifier_type, identifier_value)
      );
      CREATE INDEX IF NOT EXISTS device_register_type_status_idx ON device_register(device_type,status,archived);
      ALTER TABLE device_register ADD COLUMN IF NOT EXISTS source_buyback_order_id BIGINT;
      ALTER TABLE device_register ADD COLUMN IF NOT EXISTS storage TEXT NOT NULL DEFAULT '';
      ALTER TABLE device_register ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT '';
      ALTER TABLE device_register ADD COLUMN IF NOT EXISTS device_condition TEXT NOT NULL DEFAULT '';
      ALTER TABLE device_register ADD COLUMN IF NOT EXISTS source_webshop_order_id INTEGER REFERENCES webshop_orders(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS device_register_source_webshop_order_idx ON device_register(source_webshop_order_id) WHERE source_webshop_order_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS device_register_source_buyback_unique
        ON device_register(source_buyback_order_id)
        WHERE source_buyback_order_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS device_register_operations (
        id BIGSERIAL PRIMARY KEY,
        device_id BIGINT NOT NULL REFERENCES device_register(id) ON DELETE CASCADE,
        operation_type TEXT NOT NULL CHECK (operation_type IN ('repair','refurbishment','purchase','sale','note')),
        status TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        parts JSONB NOT NULL DEFAULT '[]'::jsonb,
        additional_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
        sale_price NUMERIC(12,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS device_register_single_sale_idx
        ON device_register_operations(device_id)
        WHERE operation_type='sale';
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS live_chat_conversations (
        id BIGSERIAL PRIMARY KEY,
        public_token TEXT NOT NULL UNIQUE,
        customer_name TEXT NOT NULL DEFAULT 'Bezoeker',
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS live_chat_messages (
        id BIGSERIAL PRIMARY KEY,
        conversation_id BIGINT NOT NULL REFERENCES live_chat_conversations(id) ON DELETE CASCADE,
        sender TEXT NOT NULL CHECK (sender IN ('customer','admin')),
        message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2000),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        read_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS live_chat_messages_conversation_idx ON live_chat_messages(conversation_id,id);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS site_settings (
        id INTEGER PRIMARY KEY,
        data JSONB NOT NULL
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        phone TEXT DEFAULT '',
        address TEXT DEFAULT '',
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Existing accounts stay active. Public signups explicitly start unverified.
    await pool.query("ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT TRUE");
    await pool.query("ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_verification_code_hash TEXT");
    await pool.query("ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMPTZ");
    await pool.query("ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_verification_attempts INTEGER NOT NULL DEFAULT 0");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS customer_password_resets (
        id BIGSERIAL PRIMARY KEY,
        customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query("CREATE INDEX IF NOT EXISTS customer_password_resets_customer_idx ON customer_password_resets (customer_id, created_at DESC)");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin',
        permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS service_orders (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
        service_category TEXT NOT NULL DEFAULT '',
        service_name TEXT NOT NULL DEFAULT '',
        service_group TEXT DEFAULT '',
        price TEXT DEFAULT '',
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT DEFAULT '',
        username TEXT DEFAULT '',
        imei TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'Nieuw',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS username TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS provider_reference TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS execution_note TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS result_data TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS execution_updated_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS appointment_date DATE`);
    await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS appointment_time TEXT`);
    await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS service_source_id TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS service_source_url TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS price_currency TEXT DEFAULT 'EUR'`);
    await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS service_instructions TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS required_fields TEXT DEFAULT '[]'`);
    await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS source_price TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS source_currency TEXT DEFAULT 'USD'`);
    await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS extra_fields TEXT DEFAULT '{}'`);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS service_orders_repair_appointment_unique
      ON service_orders (appointment_date, appointment_time)
      WHERE service_category = 'Reparatie'
        AND service_group = 'Aan huis'
        AND appointment_date IS NOT NULL
        AND appointment_time IS NOT NULL
        AND status <> 'Geannuleerd'
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS webshop_orders (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT DEFAULT '',
        street TEXT DEFAULT '',
        house_number TEXT DEFAULT '',
        postcode TEXT DEFAULT '',
        city TEXT DEFAULT '',
        items JSONB NOT NULL DEFAULT '[]'::jsonb,
        total NUMERIC(12,2) NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'Nieuw',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS webshop_order_inspections (
        order_id INTEGER PRIMARY KEY REFERENCES webshop_orders(id) ON DELETE CASCADE,
        checks JSONB NOT NULL DEFAULT '{}'::jsonb,
        inspected_by TEXT NOT NULL DEFAULT 'HOMS TECH Admin',
        completed_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS webshop_order_status_history (
        id BIGSERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES webshop_orders(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS webshop_order_status_history_order_idx
        ON webshop_order_status_history(order_id, created_at ASC);

      CREATE TABLE IF NOT EXISTS webshop_order_notes (
        id BIGSERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES webshop_orders(id) ON DELETE CASCADE,
        note TEXT NOT NULL CHECK (char_length(note) BETWEEN 1 AND 2000),
        created_by TEXT NOT NULL DEFAULT 'HOMS TECH Admin',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS webshop_order_refunds (
        id BIGSERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES webshop_orders(id) ON DELETE CASCADE,
        amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
        currency TEXT NOT NULL DEFAULT 'EUR',
        method TEXT NOT NULL CHECK (method IN ('Mollie','Manual')),
        status TEXT NOT NULL CHECK (status IN ('Processing','Pending manual','Processed','Failed')),
        reason TEXT NOT NULL DEFAULT '',
        provider_refund_id TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL DEFAULT 'HOMS TECH Admin',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS webshop_order_refunds_order_idx
        ON webshop_order_refunds(order_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS webshop_order_notes_order_idx
        ON webshop_order_notes(order_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS order_settings (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        data JSONB NOT NULL DEFAULT '{"postnlEnabled":false,"dhlEnabled":false}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Payment fields for webshop checkout / PayPal.
    await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS checkout_token TEXT NOT NULL DEFAULT ''`);
    await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'Unpaid'`);
    await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS paypal_order_id TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS mollie_payment_id TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS shipping_method TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS tracking_number TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS tracking_url TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS inventory_deducted_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS inventory_error TEXT NOT NULL DEFAULT ''`);
    // Trade-in accounting snapshot: keep the estimate and inspection result separate.
    await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS trade_in_order_id INTEGER`);
    await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS trade_in_estimated_value NUMERIC(12,2)`);
    await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS trade_in_applied_credit NUMERIC(12,2)`);
    await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS trade_in_inspected_value NUMERIC(12,2)`);
    await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS trade_in_adjustment NUMERIC(12,2) NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS trade_in_status TEXT NOT NULL DEFAULT ''`);
    await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS trade_in_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb`);
    // Idempotent email delivery after successful payment for orders containing a trade-in.
    await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS customer_order_email_claimed_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS customer_order_email_sent_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS customer_tradein_email_claimed_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS customer_tradein_email_sent_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS owner_order_email_claimed_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS owner_order_email_sent_at TIMESTAMPTZ`);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS webshop_orders_trade_in_order_unique
      ON webshop_orders(trade_in_order_id)
      WHERE trade_in_order_id IS NOT NULL
    `);


    const result = await pool.query(
      "SELECT id FROM site_settings WHERE id = 1"
    );

    if (result.rows.length === 0) {
      const defaultData = {
        siteName: "HOMS TECH",
        tagline: "Phone repair at your doorstep",
        phone: "",
        whatsapp: "",
        email: "",
        services: [
          "Screen Replacement",
          "Battery Replacement",
          "Charging Port Repair",
          "Camera Repair",
          "Software Repair"
        ],
        features: [
          "We come to your home",
          "Fast service",
          "Professional repair",
          "Warranty on repairs"
        ],
        devices: [
          {
            name: "iPhone 12",
            price: ""
          },
          {
            name: "iPhone 13",
            price: ""
          },
          {
            name: "iPhone 14",
            price: ""
          },
          {
            name: "iPhone 15",
            price: ""
          },
          {
            name: "iPhone 16",
            price: ""
          },
          {
            name: "iPhone 17",
            price: ""
          }
        ]
      };

      await pool.query(
        "INSERT INTO site_settings (id, data) VALUES (1, $1)",
        [JSON.stringify(defaultData)]
      );
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS inventory_movements (
        id BIGSERIAL PRIMARY KEY,
        item_type TEXT NOT NULL CHECK (item_type IN ('phone','shop')),
        product_id TEXT NOT NULL,
        variant_id TEXT NOT NULL DEFAULT '',
        product_name TEXT NOT NULL,
        variant_label TEXT NOT NULL DEFAULT '',
        sku TEXT NOT NULL DEFAULT '',
        movement_type TEXT NOT NULL CHECK (movement_type IN ('purchase','sale','return','damage','correction','webshop_sale')),
        quantity INTEGER NOT NULL CHECK (quantity <> 0),
        stock_before INTEGER NOT NULL CHECK (stock_before >= 0),
        stock_after INTEGER NOT NULL CHECK (stock_after >= 0),
        reference TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL DEFAULT 'Admin',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS inventory_movements_created_idx ON inventory_movements(created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS inventory_movements_product_idx ON inventory_movements(item_type, product_id, variant_id, created_at DESC);
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS manual_invoices (
        id BIGSERIAL PRIMARY KEY,
        invoice_number TEXT NOT NULL UNIQUE,
        customer_name TEXT NOT NULL,
        customer_email TEXT NOT NULL,
        customer_address TEXT NOT NULL DEFAULT '',
        kvk_number TEXT NOT NULL DEFAULT '',
        vat_id TEXT NOT NULL DEFAULT '',
        lines JSONB NOT NULL,
        subtotal NUMERIC(12,2) NOT NULL,
        vat_total NUMERIC(12,2) NOT NULL,
        total NUMERIC(12,2) NOT NULL,
        status TEXT NOT NULL DEFAULT 'Concept / test',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
}

module.exports = { initializeDatabaseSchema };
