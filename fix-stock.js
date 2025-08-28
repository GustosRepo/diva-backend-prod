// Manual stock fix script
// Run this when a purchase completes but stock doesn't get updated

import supabase from './supabaseClient.js';
import { decrementProductQuantity } from './src/controllers/productController.js';

const PRODUCT_ID = '853bfdb0-e9c8-405c-afff-7bd6594fc97b'; // From your logs
const QUANTITY_TO_DECREMENT = 1; // From your logs

async function fixStock() {
  console.log(`🔧 Manual stock fix for product ${PRODUCT_ID}, decrementing by ${QUANTITY_TO_DECREMENT}`);
  
  try {
    // Get current stock
    const { data: product, error: fetchError } = await supabase
      .from('product')
      .select('id, title, quantity')
      .eq('id', PRODUCT_ID)
      .single();
      
    if (fetchError) {
      console.error('❌ Error fetching product:', fetchError);
      return;
    }
    
    console.log(`📦 Current stock for "${product.title}": ${product.quantity}`);
    
    // Decrement stock
    const { error: decError } = await decrementProductQuantity(PRODUCT_ID, QUANTITY_TO_DECREMENT);
    
    if (decError) {
      console.error('❌ Error decrementing stock:', decError);
      return;
    }
    
    // Verify new stock
    const { data: updatedProduct } = await supabase
      .from('product')
      .select('quantity')
      .eq('id', PRODUCT_ID)
      .single();
      
    console.log(`✅ Stock updated! New quantity: ${updatedProduct.quantity}`);
    
  } catch (error) {
    console.error('❌ Script error:', error);
  }
}

fixStock();
