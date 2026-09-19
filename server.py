"""
ZKTeco ADMS Server - Praba Engineering Works
Receives attendance data from ZKTeco device and sends to Firebase
"""

from flask import Flask, request, jsonify, make_response
from datetime import datetime
import firebase_admin
from firebase_admin import credentials, firestore
import os
import json
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Firebase initialization
db = None

def init_firebase():
    global db
    try:
        # Get service account from environment variable
        service_account_json = os.environ.get('FIREBASE_SERVICE_ACCOUNT')
        if service_account_json:
            service_account_dict = json.loads(service_account_json)
            cred = credentials.Certificate(service_account_dict)
            if not firebase_admin._apps:
                firebase_admin.initialize_app(cred)
            db = firestore.client()
            logger.info("Firebase initialized successfully")
        else:
            logger.error("FIREBASE_SERVICE_ACCOUNT environment variable not set")
    except Exception as e:
        logger.error(f"Firebase init error: {e}")

# Company ID
COMPANY_ID = os.environ.get('COMPANY_ID', 'praba_engineering_works')

@app.route('/', methods=['GET'])
def home():
    return jsonify({
        "status": "running",
        "service": "Praba HR ADMS Server",
        "company": COMPANY_ID
    })

# ZKTeco ADMS endpoints
@app.route('/iclock/cdata', methods=['GET', 'POST'])
def cdata():
    """Handle ZKTeco device registration and data push"""
    
    sn = request.args.get('SN', '')
    logger.info(f"CDATA request from device: {sn}")
    
    if request.method == 'GET':
        # Device is checking in - send configuration
        options = "GET OPTION FROM: " + sn
        response_text = f"""
ATTLOGStamp=None
OPERLOGStamp=9999
ATTPHOTOStamp=None
ErrorDelay=30
Delay=10
TransTimes=00:00;14:05
TransInterval=1
TransFlag=11111000001000
TimeZone=5.5
Realtime=1
Encrypt=0
"""
        return make_response(response_text, 200)
    
    elif request.method == 'POST':
        # Device is sending attendance data
        raw_data = request.get_data(as_text=True)
        logger.info(f"Received data from {sn}: {raw_data[:200]}")
        
        if raw_data:
            process_attendance_data(sn, raw_data)
        
        return make_response("OK", 200)

@app.route('/iclock/getrequest', methods=['GET'])
def getrequest():
    """ZKTeco device polling for commands"""
    sn = request.args.get('SN', '')
    logger.info(f"GET REQUEST from device: {sn}")
    return make_response("OK", 200)

@app.route('/iclock/devicecmd', methods=['POST'])
def devicecmd():
    """Handle device command responses"""
    sn = request.args.get('SN', '')
    logger.info(f"DEVICE CMD from: {sn}")
    return make_response("OK", 200)

def process_attendance_data(sn, raw_data):
    """Parse and save attendance records to Firebase"""
    try:
        records = []
        lines = raw_data.strip().split('\n')
        
        for line in lines:
            line = line.strip()
            if not line or line.startswith('ATT'):
                continue
            
            parts = line.split('\t')
            if len(parts) >= 4:
                try:
                    emp_id = parts[0].strip()
                    timestamp_str = parts[1].strip()
                    status = parts[2].strip() if len(parts) > 2 else '0'
                    
                    # Parse timestamp
                    try:
                        dt = datetime.strptime(timestamp_str, '%Y-%m-%d %H:%M:%S')
                    except:
                        try:
                            dt = datetime.strptime(timestamp_str, '%Y-%m-%d %H:%M')
                        except:
                            continue
                    
                    date_str = dt.strftime('%Y-%m-%d')
                    time_str = dt.strftime('%H:%M:%S')
                    hour = dt.hour
                    
                    # Determine in/out based on status or time
                    if status == '0' or hour < 12:
                        in_time = time_str
                        out_time = ""
                    else:
                        in_time = ""
                        out_time = time_str
                    
                    record = {
                        "empId": emp_id,
                        "date": date_str,
                        "inTime": in_time,
                        "outTime": out_time,
                        "timestamp": int(dt.timestamp() * 1000),
                        "status": "synced",
                        "source": "biometric",
                        "deviceSN": sn
                    }
                    records.append(record)
                    logger.info(f"Parsed record: empId={emp_id}, date={date_str}, time={time_str}")
                    
                except Exception as e:
                    logger.error(f"Error parsing line '{line}': {e}")
                    continue
        
        if records and db:
            save_to_firebase(records)
            logger.info(f"Saved {len(records)} records to Firebase")
        elif not db:
            logger.error("Firebase not initialized - cannot save records")
            
    except Exception as e:
        logger.error(f"Error processing attendance data: {e}")

def save_to_firebase(records):
    """Save attendance records to Firebase Firestore"""
    try:
        # Group by date
        by_date = {}
        for rec in records:
            date = rec['date']
            if date not in by_date:
                by_date[date] = []
            by_date[date].append(rec)
        
        company_ref = db.collection('companies').document(COMPANY_ID)
        
        for date, day_records in by_date.items():
            doc_ref = company_ref.collection('attendance').document(date)
            
            # Merge with existing records
            existing = doc_ref.get()
            if existing.exists:
                existing_records = existing.to_dict().get('records', [])
                # Avoid duplicates based on empId + timestamp
                existing_keys = {(r['empId'], r.get('timestamp', 0)) for r in existing_records}
                new_records = [r for r in day_records if (r['empId'], r.get('timestamp', 0)) not in existing_keys]
                all_records = existing_records + new_records
            else:
                all_records = day_records
            
            doc_ref.set({'records': all_records}, merge=True)
            logger.info(f"Firebase updated for date {date}: {len(all_records)} total records")
            
    except Exception as e:
        logger.error(f"Firebase save error: {e}")

# Initialize Firebase on startup
init_firebase()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
