/*
  Warnings:

  - Made the column `productPrice` on table `Order` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Order" ALTER COLUMN "productPrice" SET NOT NULL;
