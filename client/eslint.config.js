/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'chatgpt-sidebar': '#202123',
        'chatgpt-main-bg': '#343541',
        'chatgpt-message-ai': '#444654', // Background for AI messages
        'chatgpt-input-bg': '#40414F',
        'chatgpt-input-border': '#40414F', // Often same as input bg
        'chatgpt-user-bubble': '#3B82F6', // Blue for user messages
        'chatgpt-text-primary': '#ECECEC', // General text color
        'chatgpt-text-secondary': '#A0A0A0', // Lighter text for secondary info
        'chatgpt-accent-blue': '#10A37F', // ChatGPT's main green-ish accent (for new chat, etc.) - we'll keep blue for buttons for now as per your prior request.
        'chatgpt-hover-gray': '#2A2B32', // Used for sidebar hover states
      },
      fontFamily: {
        inter: ['Inter', 'sans-serif'], // Define custom font family
      }
    },
  },
  plugins: [],
}