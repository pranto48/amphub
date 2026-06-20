#!/bin/bash
# deploy.sh - Remote deployment script for AMPHUB

set -e

REMOTE_IP="192.168.9.9"
REMOTE_USER="it"
REMOTE_PASS="Interst0ff"
WEB_PORT="3355"

echo "=== Packaging AMPHUB ==="
# Compress source code, excluding build and dependency folders
tar -czf /tmp/amphub.tar.gz \
  --exclude="node_modules" \
  --exclude=".git" \
  --exclude="dist" \
  --exclude="server/node_modules" \
  --exclude="server/update-shared" \
  --exclude="update-shared" \
  .

echo "=== Uploading Package to Remote Server $REMOTE_IP ==="
expect -c "
set timeout 60
spawn scp -o StrictHostKeyChecking=no /tmp/amphub.tar.gz ${REMOTE_USER}@${REMOTE_IP}:/home/${REMOTE_USER}/amphub.tar.gz
expect {
    \"*password:\" { send \"${REMOTE_PASS}\r\" }
    timeout { exit 1 }
}
expect eof
"

echo "=== Setting Up Directories & Extracting Package ==="
expect -c "
set timeout 60
spawn ssh -o StrictHostKeyChecking=no ${REMOTE_USER}@${REMOTE_IP}
expect {
    \"*password:\" { send \"${REMOTE_PASS}\r\" }
    timeout { exit 1 }
}
expect -re \"\\\\\\$|#\"
send \"rm -rf /home/${REMOTE_USER}/amphub && mkdir -p /home/${REMOTE_USER}/amphub && tar -xzf /home/${REMOTE_USER}/amphub.tar.gz -C /home/${REMOTE_USER}/amphub && rm -f /home/${REMOTE_USER}/amphub.tar.gz\r\"
expect -re \"\\\\\\$|#\"
send \"exit\r\"
expect eof
"

echo "=== Creating Configuration & Environment Secrets ==="
expect -c "
set timeout 60
spawn ssh -o StrictHostKeyChecking=no ${REMOTE_USER}@${REMOTE_IP}
expect {
    \"*password:\" { send \"${REMOTE_PASS}\r\" }
    timeout { exit 1 }
}
expect -re \"\\\\\\$|#\"
send \"cd /home/${REMOTE_USER}/amphub && JWT_SEC=\\\$(openssl rand -hex 24) && UPD_SEC=\\\$(openssl rand -hex 24) && echo \\\"JWT_SECRET=\\\\\\\$JWT_SEC\\\" > .env && echo \\\"UPDATE_SHARED_SECRET=\\\\\\\$UPD_SEC\\\" >> .env && echo \\\"BOOTSTRAP_DEFAULT_ADMIN=false\\\" >> .env && mkdir -p update-shared && echo -n \\\\\\\$UPD_SEC > update-shared/.secret && chmod 600 update-shared/.secret\r\"
expect -re \"\\\\\\$|#\"
send \"exit\r\"
expect eof
"

echo "=== Building and Starting Docker Containers ==="
expect -c "
set timeout 180
spawn ssh -o StrictHostKeyChecking=no ${REMOTE_USER}@${REMOTE_IP}
expect {
    \"*password:\" { send \"${REMOTE_PASS}\r\" }
    timeout { exit 1 }
}
expect -re \"\\\\\\$|#\"
# Attempt running with sudo to guarantee docker command permissions.
send \"cd /home/${REMOTE_USER}/amphub && sudo docker compose down --remove-orphans && sudo docker compose build && sudo docker compose up -d\r\"
expect {
    \"*password*\" { send \"${REMOTE_PASS}\r\"; exp_continue }
    -re \"\\\\\\$|#\"
}
send \"exit\r\"
expect eof
"

echo "=== Verification Check ==="
expect -c "
set timeout 20
spawn ssh -o StrictHostKeyChecking=no ${REMOTE_USER}@${REMOTE_IP}
expect {
    \"*password:\" { send \"${REMOTE_PASS}\r\" }
    timeout { exit 1 }
}
expect -re \"\\\\\\$|#\"
send \"sudo docker ps\r\"
expect {
    \"*password*\" { send \"${REMOTE_PASS}\r\"; exp_continue }
    -re \"\\\\\\$|#\"
}
send \"exit\r\"
expect eof
"

# Clean local temporary tarball
rm -f /tmp/amphub.tar.gz

echo "=========================================================="
echo " REMOTE DEPLOYMENT ATTEMPT COMPLETE"
echo "=========================================================="
echo "Target URL:      http://${REMOTE_IP}:${WEB_PORT}"
echo "Admin User:      admin@amphub.com"
echo "Admin Password:  ${REMOTE_PASS}"
echo "=========================================================="
