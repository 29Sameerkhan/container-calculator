import { sql } from 'drizzle-orm';
import { text, integer, real, sqliteTable } from 'drizzle-orm/sqlite-core';

export const calculations = sqliteTable('calculations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  customerName: text('customer_name').notNull().default(''),
  orderRef: text('order_ref').notNull().default(''),
  totalCbm: real('total_cbm').notNull(),
  totalGrossKg: real('total_gross_kg').notNull(),
  containerRecommendation: text('container_recommendation').notNull(),
  palletCount: integer('pallet_count').notNull(),
  itemsJson: text('items_json').notNull(),   // JSON string of OrderItem[]
  resultJson: text('result_json').notNull(), // JSON string of ShipmentResult
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export type Calculation = typeof calculations.$inferSelect;
export type NewCalculation = typeof calculations.$inferInsert;
