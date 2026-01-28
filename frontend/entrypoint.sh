#!/bin/sh

# Generate runtime environment config from environment variables
cat <<EOF > /usr/share/nginx/html/env-config.js
window.ENV = {
  VITE_IAM_API_URL: "${VITE_IAM_API_URL:-http://localhost:3001}",
  VITE_PRODUCT_API_URL: "${VITE_PRODUCT_API_URL:-http://localhost:3002}",
  VITE_ORDER_API_URL: "${VITE_ORDER_API_URL:-http://localhost:3003}",
};
EOF

echo "Generated env-config.js with:"
cat /usr/share/nginx/html/env-config.js

# Start nginx
exec nginx -g 'daemon off;'
