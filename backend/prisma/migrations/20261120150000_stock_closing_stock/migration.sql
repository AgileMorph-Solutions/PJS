-- "Closing stock (kg)" on the stock step: the warehouse's stock before this truck, typed by hand for now (Nov 2026).
-- Total warehouse stock after this truck = closing stock + added to stock, calculated. Text like every stage column.
ALTER TABLE "StageStockUpdate" ADD COLUMN "closingStock" TEXT;
