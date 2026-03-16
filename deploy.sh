#!/bin/bash

# 🚀 Netlify Auto-Deploy Script (No-Git Edition)
TOKEN="nfp_spC8vjMmZ9XNAVU6DtQWHs3hkLcuWoxU7af6"
SITE_ID="4af62a2f-d560-49ed-b319-e1d724968013"
ZIP_FILE="deploy_package.zip"

echo "📦 Packaging project..."
# Remove old zip if exists
rm -f $ZIP_FILE

# Zip all project files, excluding scripts and system files
zip -r $ZIP_FILE . -x "*.zip" -x "*.sh" -x "*.py" -x ".git*" -x "node_modules/*"

echo "📡 Uploading to Netlify..."
RESPONSE=$(curl -s -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/zip" \
     --data-binary "@$ZIP_FILE" \
     "https://api.netlify.com/api/v1/sites/$SITE_ID/deploys")

# Check for success
if [[ $RESPONSE == *"\"state\":\"uploaded\""* ]] || [[ $RESPONSE == *"\"state\":\"ready\""* ]]; then
    echo "✅ Success! Site updated at https://qainterface.netlify.app/"
else
    echo "❌ Error during deployment."
    echo $RESPONSE
fi

# Cleanup
rm -f $ZIP_FILE
