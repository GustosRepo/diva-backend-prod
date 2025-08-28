/*
  Warnings:

  - Made the column `email` on table `Order` required. This step will fail if there are existing NULL values in that column.
  - Made the column `orderId` on table `Order` required. This step will fail if there are existing NULL values in that column.
  - Made the column `shippingInfo` on table `Order` required. This step will fail if there are existing NULL values in that column.
  - Made the column `totalAmount` on table `Order` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `price` to the `OrderItem` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Order" ALTER COLUMN "email" SET NOT NULL,
ALTER COLUMN "orderId" SET NOT NULL,
ALTER COLUMN "shippingInfo" SET NOT NULL,
ALTER COLUMN "totalAmount" SET NOT NULL;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "price" DOUBLE PRECISION NOT NULL;
