import { addDoc, deleteDoc, doc, setDoc, updateDoc } from '../firestore-ops.js';

export function createMealLibraryFood(foodsCollection, payload) {
    if (!foodsCollection) return Promise.reject(new Error('meal_library_foods_missing'));
    return addDoc(foodsCollection, { ...payload });
}

export function updateMealLibraryFood(foodRef, patch) {
    if (!foodRef) return Promise.reject(new Error('meal_food_ref_missing'));
    return updateDoc(foodRef, { ...(patch || {}) });
}

export function deleteMealLibraryFood(foodRef) {
    if (!foodRef) return Promise.reject(new Error('meal_food_ref_missing'));
    return deleteDoc(foodRef);
}

export function createMealLibraryRecipe(recipesCollection, payload) {
    if (!recipesCollection) return Promise.reject(new Error('meal_library_recipes_missing'));
    return addDoc(recipesCollection, { ...payload });
}

export function updateMealLibraryRecipe(recipeRef, patch) {
    if (!recipeRef) return Promise.reject(new Error('meal_recipe_ref_missing'));
    return updateDoc(recipeRef, { ...(patch || {}) });
}

export function deleteMealLibraryRecipe(recipeRef) {
    if (!recipeRef) return Promise.reject(new Error('meal_recipe_ref_missing'));
    return deleteDoc(recipeRef);
}

export function setGlobalMealFoodRecord(globalCollection, recordId, payload, options = { merge: true }) {
    if (!globalCollection || !recordId) return Promise.reject(new Error('meal_global_food_ref_missing'));
    return setDoc(doc(globalCollection, recordId), { ...(payload || {}) }, options);
}

export function updateGlobalMealFoodRecord(globalCollection, recordId, patch) {
    if (!globalCollection || !recordId) return Promise.reject(new Error('meal_global_food_ref_missing'));
    return updateDoc(doc(globalCollection, recordId), { ...(patch || {}) });
}

export function deleteGlobalMealFoodRecord(globalCollection, recordId) {
    if (!globalCollection || !recordId) return Promise.reject(new Error('meal_global_food_ref_missing'));
    return deleteDoc(doc(globalCollection, recordId));
}
