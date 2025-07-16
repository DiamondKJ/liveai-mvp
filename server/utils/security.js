/**
 * Security utilities for input validation
 */

// Maximum character limits for different input types
const CHARACTER_LIMITS = {
  userName: 50,
  roomCode: 10,
  messageText: 2000,
  chatId: 100,
  roomDBId: 100,
  general: 1000  // Default limit for any other fields
};

/**
 * Validates input against character limits
 * @param {string} input - The input to validate
 * @param {string} inputType - Type of input (userName, roomCode, etc.)
 * @returns {Object} Result object with validation status
 */
function validateInput(input, inputType = 'general') {
  // Return early if input is not a string or is null/undefined
  if (input === null || input === undefined) {
    return { valid: true }; // Allow null/undefined values as they might be optional
  }
  
  // Convert to string if it's not already
  const stringInput = String(input);
  
  // Get the appropriate character limit
  const limit = CHARACTER_LIMITS[inputType] || CHARACTER_LIMITS.general;
  
  // Check if the input exceeds the limit
  if (stringInput.length > limit) {
    return {
      valid: false,
      reason: `Input exceeds maximum character limit of ${limit} characters`
    };
  }
  
  return { valid: true };
}

/**
 * Validates an object's string properties against character limits
 * @param {Object} data - Object containing input fields
 * @param {Object} fieldTypes - Mapping of field names to input types
 * @returns {Object} Validation result
 */
function validateObject(data, fieldTypes = {}) {
  // If data is not an object, return invalid
  if (!data || typeof data !== 'object') {
    return {
      valid: false,
      reason: 'Invalid input: Expected an object'
    };
  }
  
  // Validate each field in the data object
  for (const [field, value] of Object.entries(data)) {
    // Skip validation for arrays or objects (could be extended to validate these too)
    if (Array.isArray(value) || (value !== null && typeof value === 'object')) {
      continue;
    }
    
    // Get the field type or use general as default
    const fieldType = fieldTypes[field] || 'general';
    
    // Validate the field
    const result = validateInput(value, fieldType);
    
    // If validation fails, return the failure reason
    if (!result.valid) {
      return {
        valid: false,
        reason: `Field '${field}' is invalid: ${result.reason}`,
        field
      };
    }
  }
  
  return { valid: true };
}

module.exports = {
  validateInput,
  validateObject,
  CHARACTER_LIMITS
};
