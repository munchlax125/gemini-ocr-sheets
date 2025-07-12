from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import fitz  # PyMuPDF
import os
import tempfile
import zipfile
import json
from werkzeug.utils import secure_filename
import uuid
from datetime import datetime
import shutil
import threading
import time
import queue
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
import subprocess

app = Flask(__name__)
CORS(app)

# 로깅 설정
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 설정
UPLOAD_FOLDER = 'pdfs'
PROCESSED_FOLDER = 'masked-pdfs'
MAX_FILE_SIZE = 16 * 1024 * 1024  # 16MB
ALLOWED_EXTENSIONS = {'pdf'}
MAX_WORKERS = 4  # 동시 처리 스레드 수
BATCH_SIZE = 50  # 배치 크기

# 작업 상태 추적
job_status = {}
job_lock = threading.Lock()

# 폴더 생성
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(PROCESSED_FOLDER, exist_ok=True)

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def update_job_status(job_id, status, progress=0, message="", error=None):
    """작업 상태 업데이트"""
    with job_lock:
        job_status[job_id] = {
            'status': status,  # 'pending', 'running', 'completed', 'failed'
            'progress': progress,  # 0-100
            'message': message,
            'error': error,
            'timestamp': datetime.now().isoformat()
        }

def redact_pdf_batch(files_batch, redaction_areas, job_id):
    """PDF 배치 마스킹 처리"""
    processed_files = []
    
    for i, (input_path, output_path, filename) in enumerate(files_batch):
        try:
            # PDF 마스킹 처리
            doc = fitz.open(input_path)
            
            for page in doc:
                for area in redaction_areas:
                    rect = fitz.Rect(area['x1'], area['y1'], area['x2'], area['y2'])
                    page.add_redact_annot(rect)
                page.apply_redactions()
            
            doc.save(output_path)
            doc.close()
            
            processed_files.append({
                'original_name': filename,
                'masked_name': os.path.basename(output_path),
                'size': os.path.getsize(output_path)
            })
            
            # 진행률 업데이트
            progress = ((i + 1) / len(files_batch)) * 100
            update_job_status(job_id, 'running', progress, f'배치 처리 중: {i+1}/{len(files_batch)}')
            
        except Exception as e:
            logger.error(f"파일 {filename} 처리 오류: {e}")
            continue
    
    return processed_files

def process_large_masking(pdf_files, redaction_areas, job_id):
    """대용량 파일 마스킹 처리"""
    try:
        update_job_status(job_id, 'running', 0, '마스킹 작업 시작')
        
        # 기존 마스킹 파일들 정리
        if os.path.exists(PROCESSED_FOLDER):
            for file in os.listdir(PROCESSED_FOLDER):
                if file.endswith('.pdf'):
                    os.remove(os.path.join(PROCESSED_FOLDER, file))
        
        # 파일을 배치로 나누기
        batches = [pdf_files[i:i + BATCH_SIZE] for i in range(0, len(pdf_files), BATCH_SIZE)]
        total_files = len(pdf_files)
        processed_count = 0
        all_processed_files = []
        file_mapping = []
        
        # 각 배치를 순차 처리 (메모리 관리)
        for batch_idx, batch in enumerate(batches):
            update_job_status(job_id, 'running', 
                            (batch_idx / len(batches)) * 90,  # 90%까지는 처리 과정
                            f'배치 {batch_idx + 1}/{len(batches)} 처리 중')
            
            # 배치용 파일 경로 준비
            batch_files = []
            for filename in batch:
                file_number = processed_count + len(batch_files) + 1
                input_path = os.path.join(UPLOAD_FOLDER, filename)
                output_filename = f"{file_number}.pdf"
                output_path = os.path.join(PROCESSED_FOLDER, output_filename)
                batch_files.append((input_path, output_path, filename))
            
            # 배치 처리
            batch_result = redact_pdf_batch(batch_files, redaction_areas, job_id)
            all_processed_files.extend(batch_result)
            
            # 매핑 정보 생성
            for i, filename in enumerate(batch):
                file_number = processed_count + i + 1
                file_mapping.append({
                    'number': file_number,
                    'original_name': filename,
                    'masked_name': f"{file_number}.pdf"
                })
            
            processed_count += len(batch)
            
            # 진행률 업데이트
            overall_progress = (processed_count / total_files) * 90
            update_job_status(job_id, 'running', overall_progress, 
                            f'처리 완료: {processed_count}/{total_files}')
            
            # 메모리 정리를 위한 잠시 대기
            time.sleep(0.1)
        
        # 매핑 정보 저장
        mapping_path = os.path.join(PROCESSED_FOLDER, 'file_mapping.json')
        with open(mapping_path, 'w', encoding='utf-8') as f:
            json.dump(file_mapping, f, ensure_ascii=False, indent=2)
        
        update_job_status(job_id, 'completed', 100, 
                         f'마스킹 완료: {len(all_processed_files)}개 파일 처리됨')
        
        return {
            'processed_files': all_processed_files,
            'file_mapping': file_mapping,
            'total_processed': len(all_processed_files)
        }
        
    except Exception as e:
        update_job_status(job_id, 'failed', 0, '', str(e))
        raise

@app.route('/')
def index():
    return '''
    <!DOCTYPE html>
    <html>
    <head>
        <title>대용량 PDF 처리 서버</title>
    </head>
    <body>
        <h1>🚀 대용량 PDF 통합 처리 백엔드 서버</h1>
        <p>대용량 파일 처리를 위한 향상된 서버가 실행 중입니다!</p>
        <p>배치 처리 및 비동기 작업을 지원합니다.</p>
    </body>
    </html>
    '''

@app.route('/upload', methods=['POST'])
def upload_files():
    """파일 업로드 엔드포인트 (메모리 최적화)"""
    try:
        if 'files' not in request.files:
            return jsonify({'error': '파일이 없습니다.'}), 400
        
        files = request.files.getlist('files')
        if not files or files[0].filename == '':
            return jsonify({'error': '선택된 파일이 없습니다.'}), 400
        
        # 기존 파일들 정리
        if os.path.exists(UPLOAD_FOLDER):
            for file in os.listdir(UPLOAD_FOLDER):
                if file.endswith('.pdf'):
                    os.remove(os.path.join(UPLOAD_FOLDER, file))
        
        uploaded_files = []
        total_size = 0
        
        # 파일 크기 및 개수 체크
        for file in files:
            if file and allowed_file(file.filename):
                file_size = len(file.read())
                if file_size > MAX_FILE_SIZE:
                    return jsonify({'error': f'{file.filename} 파일이 너무 큽니다. (최대 16MB)'}), 400
                total_size += file_size
                file.seek(0)
        
        # 총 크기 체크 (10GB 제한)
        if total_size > 10 * 1024 * 1024 * 1024:
            return jsonify({'error': '총 파일 크기가 10GB를 초과합니다.'}), 400
        
        # 파일 저장 (스트리밍 방식)
        for file in files:
            if file and allowed_file(file.filename):
                filename = file.filename
                file_path = os.path.join(UPLOAD_FOLDER, filename)
                
                # 스트리밍으로 저장 (메모리 절약)
                with open(file_path, 'wb') as f:
                    while True:
                        chunk = file.read(8192)  # 8KB 청크
                        if not chunk:
                            break
                        f.write(chunk)
                
                uploaded_files.append({
                    'filename': filename,
                    'size': os.path.getsize(file_path)
                })
        
        # 파일명 순서로 정렬
        uploaded_files.sort(key=lambda x: x['filename'])
        
        return jsonify({
            'success': True,
            'session_id': 'batch_session',
            'files': uploaded_files,
            'count': len(uploaded_files),
            'total_size': total_size
        })
        
    except Exception as e:
        return jsonify({'error': f'업로드 중 오류: {str(e)}'}), 500

@app.route('/mask-async', methods=['POST'])
def mask_pdfs_async():
    """비동기 PDF 마스킹 처리 시작"""
    try:
        data = request.json
        masking_areas = data.get('masking_areas', [])
        
        if not masking_areas:
            return jsonify({'error': '마스킹 영역이 필요합니다.'}), 400
        
        if not os.path.exists(UPLOAD_FOLDER):
            return jsonify({'error': '업로드된 파일이 없습니다.'}), 400
        
        # 파일 목록 가져오기
        pdf_files = [f for f in os.listdir(UPLOAD_FOLDER) if f.lower().endswith('.pdf')]
        pdf_files.sort()
        
        if not pdf_files:
            return jsonify({'error': '처리할 PDF 파일이 없습니다.'}), 400
        
        # 작업 ID 생성
        job_id = str(uuid.uuid4())
        update_job_status(job_id, 'pending', 0, f'{len(pdf_files)}개 파일 처리 대기 중')
        
        # 백그라운드에서 비동기 처리 시작
        def background_task():
            try:
                result = process_large_masking(pdf_files, masking_areas, job_id)
                # 결과를 job_status에 저장
                with job_lock:
                    job_status[job_id]['result'] = result
            except Exception as e:
                update_job_status(job_id, 'failed', 0, '', str(e))
        
        thread = threading.Thread(target=background_task)
        thread.daemon = True
        thread.start()
        
        return jsonify({
            'success': True,
            'job_id': job_id,
            'message': f'{len(pdf_files)}개 파일의 마스킹 처리가 시작되었습니다.',
            'estimated_time': f'{len(pdf_files) * 2} 초 예상'
        })
        
    except Exception as e:
        return jsonify({'error': f'작업 시작 중 오류: {str(e)}'}), 500

@app.route('/job-status/<job_id>')
def get_job_status(job_id):
    """작업 상태 조회"""
    with job_lock:
        if job_id not in job_status:
            return jsonify({'error': '작업 ID를 찾을 수 없습니다.'}), 404
        return jsonify(job_status[job_id])

@app.route('/run-gemini-ocr-async', methods=['POST'])
def run_gemini_ocr_async():
    """비동기 Gemini OCR 처리"""
    try:
        if not os.path.exists(PROCESSED_FOLDER):
            return jsonify({'error': '마스킹된 파일이 없습니다.'}), 400
        
        # 작업 ID 생성
        job_id = str(uuid.uuid4())
        update_job_status(job_id, 'pending', 0, 'OCR 처리 대기 중')
        
        def background_ocr():
            try:
                update_job_status(job_id, 'running', 10, 'Gemini OCR 스크립트 실행 중...')
                
                # 환경 변수 설정
                env = os.environ.copy()
                env['PYTHONIOENCODING'] = 'utf-8'
                
                # 스크립트 실행
                result = subprocess.run(
                    ['python', 'gemini-pdf-ocr-genai.py'], 
                    capture_output=True, 
                    text=True, 
                    timeout=3600,  # 1시간 타임아웃
                    encoding='utf-8',
                    env=env
                )
                
                if result.returncode == 0:
                    update_job_status(job_id, 'completed', 100, 'OCR 처리 완료')
                    with job_lock:
                        job_status[job_id]['result'] = {
                            'output': result.stdout,
                            'success': True
                        }
                else:
                    update_job_status(job_id, 'failed', 0, 'OCR 처리 실패', result.stderr)
                    
            except subprocess.TimeoutExpired:
                update_job_status(job_id, 'failed', 0, 'OCR 처리 시간 초과', '1시간 타임아웃')
            except Exception as e:
                update_job_status(job_id, 'failed', 0, 'OCR 처리 오류', str(e))
        
        thread = threading.Thread(target=background_ocr)
        thread.daemon = True
        thread.start()
        
        return jsonify({
            'success': True,
            'job_id': job_id,
            'message': 'OCR 처리가 시작되었습니다. (최대 1시간 소요)'
        })
        
    except Exception as e:
        return jsonify({'error': f'OCR 작업 시작 중 오류: {str(e)}'}), 500

@app.route('/extract-info', methods=['POST'])
def extract_personal_info():
    """개인정보 추출 (기존과 동일)"""
    try:
        if not os.path.exists(UPLOAD_FOLDER):
            return jsonify({'error': '업로드된 파일이 없습니다.'}), 400
        
        pdf_files = [f for f in os.listdir(UPLOAD_FOLDER) if f.lower().endswith('.pdf')]
        pdf_files.sort()
        
        personal_info = []
        
        for i, filename in enumerate(pdf_files, 1):
            file_base = filename.replace('.pdf', '')
            parts = file_base.split('_')
            
            if len(parts) >= 2:
                name = parts[0]
                birth_date = parts[1]
                
                if len(birth_date) == 6 or len(birth_date) == 8:
                    if birth_date.isdigit():
                        personal_info.append({
                            'order': i,
                            'name': name,
                            'birth_date': birth_date,
                            'original_filename': filename
                        })
        
        return jsonify({
            'success': True,
            'session_id': 'batch_session',
            'personal_info': personal_info,
            'total_extracted': len(personal_info)
        })
        
    except Exception as e:
        return jsonify({'error': f'정보 추출 중 오류: {str(e)}'}), 500

@app.route('/download-masked/<session_id>')
def download_masked_files(session_id):
    """마스킹된 파일들을 ZIP으로 다운로드"""
    try:
        if not os.path.exists(PROCESSED_FOLDER):
            return jsonify({'error': '마스킹된 파일이 없습니다.'}), 400
        
        zip_path = os.path.join(tempfile.gettempdir(), 
                               f'masked_files_{datetime.now().strftime("%Y%m%d_%H%M%S")}.zip')
        
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for filename in os.listdir(PROCESSED_FOLDER):
                if filename.endswith('.pdf'):
                    file_path = os.path.join(PROCESSED_FOLDER, filename)
                    zipf.write(file_path, filename)
            
            mapping_path = os.path.join(PROCESSED_FOLDER, 'file_mapping.json')
            if os.path.exists(mapping_path):
                zipf.write(mapping_path, 'file_mapping.json')
        
        return send_file(
            zip_path,
            as_attachment=True,
            download_name=f'masked_pdfs_{datetime.now().strftime("%Y%m%d_%H%M%S")}.zip',
            mimetype='application/zip'
        )
        
    except Exception as e:
        return jsonify({'error': f'다운로드 중 오류: {str(e)}'}), 500

@app.route('/health')
def health_check():
    """서버 상태 확인"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'version': '2.0.0 (Enhanced)',
        'max_workers': MAX_WORKERS,
        'batch_size': BATCH_SIZE
    })

if __name__ == '__main__':
    print("🚀 대용량 PDF 통합 처리 백엔드 서버를 시작합니다...")
    print(f"📂 업로드 폴더: {UPLOAD_FOLDER}")
    print(f"📂 처리 폴더: {PROCESSED_FOLDER}")
    print(f"⚙️ 최대 동시 처리: {MAX_WORKERS} 스레드")
    print(f"📦 배치 크기: {BATCH_SIZE} 파일")
    print("🌐 서버 주소: http://localhost:5000")
    
    app.run(debug=True, host='0.0.0.0', port=5000, threaded=True)