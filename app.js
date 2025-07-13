// app.js - 메인 애플리케이션 로직
// 전역 변수
let scannedFiles = [];
let maskedFiles = [];
let personalInfoData = [];
let fileMappingData = [];
let currentJobId = null;
let ocrJobId = null;
let lastLogUpdate = null; // 마지막 로그 업데이트 시간
const API_BASE_URL = 'http://localhost:5000';

// DOM 요소
const scanFolderBtn = document.getElementById('scanFolderBtn');
const startMaskingBtn = document.getElementById('startMaskingBtn');
const startOCRBtn = document.getElementById('startOCRBtn');
const generateExcelBtn = document.getElementById('generateExcelBtn');
const resultsSection = document.getElementById('resultsSection');

// API 호출 클래스
class APIClient {
    static async scanPDFs() {
        const response = await fetch(`${API_BASE_URL}/scan-pdfs`);
        if (!response.ok) {
            throw new Error(`서버 오류: ${response.status}`);
        }
        return await response.json();
    }
    
    static async maskPDFs() {
        const response = await fetch(`${API_BASE_URL}/mask-pdfs`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        });
        if (!response.ok) {
            throw new Error(`서버 오류: ${response.status}`);
        }
        return await response.json();
    }
    
    static async runOCR() {
        const response = await fetch(`${API_BASE_URL}/run-gemini-ocr-async`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        });
        if (!response.ok) {
            throw new Error(`서버 오류: ${response.status}`);
        }
        return await response.json();
    }
    
    static async extractInfo() {
        const response = await fetch(`${API_BASE_URL}/extract-info`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        });
        if (!response.ok) {
            throw new Error(`서버 오류: ${response.status}`);
        }
        return await response.json();
    }
    
    static async getJobStatus(jobId) {
        const response = await fetch(`${API_BASE_URL}/job-status/${jobId}`);
        if (!response.ok) return null;
        return await response.json();
    }
    
    static async checkHealth() {
        const response = await fetch(`${API_BASE_URL}/health`);
        if (!response.ok) throw new Error('서버 연결 실패');
        return await response.json();
    }
}

// 이벤트 핸들러
async function handleFolderScan() {
    scanFolderBtn.disabled = true;
    UIController.showStepMessage(1, 'pdfs 폴더를 스캔하는 중...', 'info');
    UIController.updateProgress('scanProgress', 50);

    try {
        const result = await APIClient.scanPDFs();
        
        if (result.success) {
            scannedFiles = result.files;
            displayScannedFiles(result);
            UIController.completeStep(1);
            startMaskingBtn.disabled = false;
            UIController.updateProgress('scanProgress', 100);
            
            UIController.showStepMessage(1, `${result.count}개의 PDF 파일이 발견되었습니다.`, 'success');
        } else {
            throw new Error(result.error || '스캔 실패');
        }

    } catch (error) {
        UIController.showStepMessage(1, `스캔 중 오류: ${error.message}`, 'error');
        UIController.updateProgress('scanProgress', 0);
    } finally {
        scanFolderBtn.disabled = false;
    }
}

async function handleMasking() {
    if (scannedFiles.length === 0) {
        UIController.showStepMessage(2, '먼저 폴더를 스캔해주세요.', 'error');
        return;
    }

    startMaskingBtn.disabled = true;
    UIController.showStepMessage(2, '서버에서 마스킹 처리를 시작합니다...', 'info');

    try {
        const result = await APIClient.maskPDFs();
        
        if (result.success) {
            currentJobId = result.job_id;
            UIController.showStepMessage(2, result.message, 'success');
            
            pollJobStatus(result.job_id, 2, () => {
                UIController.completeStep(2);
                startOCRBtn.disabled = false;
                generateExcelBtn.disabled = false;
                UIController.showStepMessage(3, '이제 OCR 처리를 시작할 수 있습니다.', 'info');
            });
            
        } else {
            throw new Error(result.error || '마스킹 처리 실패');
        }
        
    } catch (error) {
        UIController.showStepMessage(2, `마스킹 처리 중 오류: ${error.message}`, 'error');
        startMaskingBtn.disabled = false;
    }
}

async function handleOCR() {
    startOCRBtn.disabled = true;
    
    // 파란색 메시지도 최소화
    // UIController.showStepMessage(3, 'Gemini OCR 스크립트를 실행합니다...', 'info');

    try {
        const result = await APIClient.runOCR();
        
        if (result.success) {
            ocrJobId = result.job_id;
            
            // OCR 작업에 대해서는 실시간 상태 폴링 (로그 없이)
            pollOCRJobWithLogs(result.job_id, () => {
                UIController.completeStep(3);
                UIController.hideCurrentFile(); // 현재 파일 표시 숨김
                // 완료 메시지도 최소화
                // UIController.showStepMessage(3, 'OCR 처리가 완료되었습니다!', 'success');
            });
            
        } else {
            throw new Error(result.error || 'OCR 처리 실패');
        }
        
    } catch (error) {
        UIController.showStepMessage(3, `OCR 처리 중 오류: ${error.message}`, 'error');
        UIController.hideCurrentFile();
        startOCRBtn.disabled = false;
    }
}

async function handleExcelGeneration() {
    if (scannedFiles.length === 0) {
        UIController.showStepMessage(4, '원본 파일이 없습니다.', 'error');
        return;
    }

    generateExcelBtn.disabled = true;
    UIController.showStepMessage(4, '개인정보를 추출하여 엑셀을 생성하는 중...', 'info');

    try {
        const result = await APIClient.extractInfo();
        
        if (result.success) {
            personalInfoData = result.personal_info;
            UIController.updateProgress('excelProgress', 100);
            
            if (personalInfoData.length > 0) {
                UIController.completeStep(4);
                displayResults();
                
                // 다이렉트 다운로드 버튼 표시
                const downloadDirectBtn = document.getElementById('downloadExcelDirectBtn');
                downloadDirectBtn.style.display = 'block';
                
                UIController.showStepMessage(4, `${personalInfoData.length}개 항목의 개인정보 엑셀이 생성되었습니다!`, 'success');
            } else {
                UIController.showStepMessage(4, '올바른 형식의 파일이 없습니다. 파일명이 "이름_생년월일.pdf" 형태인지 확인해주세요.', 'error');
            }
        } else {
            throw new Error(result.error || '정보 추출 실패');
        }
        
    } catch (error) {
        UIController.showStepMessage(4, `엑셀 생성 중 오류: ${error.message}`, 'error');
    } finally {
        generateExcelBtn.disabled = false;
    }
}

// OCR 작업 전용 폴링 함수 (단순화 + 로그 문제 해결)
async function pollOCRJobWithLogs(jobId, onComplete) {
    let lastKnownLogLength = 0;
    let pollInterval = 2000; // 기본 2초로 늘림
    
    const poll = async () => {
        try {
            const status = await APIClient.getJobStatus(jobId);
            if (!status) {
                console.log('❌ 상태 정보 없음');
                setTimeout(poll, pollInterval);
                return;
            }
            
            console.log(`📊 진행률: ${status.progress}%, 상태: ${status.status}`);
            
            // 진행률 업데이트
            UIController.updateProgress('ocrProgress', status.progress);
            
            // 로그에서 현재 파일명만 간단하게 추출
            if (status.log_output) {
                const logLines = status.log_output.split('\n');
                
                // 전체 로그에서 가장 최근 파일명 찾기
                for (let i = logLines.length - 1; i >= 0; i--) {
                    const line = logLines[i];
                    if (line.trim()) {
                        const currentFile = extractFileName(line);
                        if (currentFile) {
                            UIController.showCurrentFile(currentFile, '처리 중...');
                            break;
                        }
                    }
                }
                
                lastKnownLogLength = logLines.length;
            }
            
            if (status.status === 'completed') {
                UIController.updateProgress('ocrProgress', 100);
                UIController.hideCurrentFile();
                onComplete();
                return;
                
            } else if (status.status === 'failed') {
                UIController.showStepMessage(3, `작업 실패: ${status.error}`, 'error');
                UIController.hideCurrentFile();
                startOCRBtn.disabled = false;
                return;
            }
            
            // 다음 폴링 예약
            setTimeout(poll, pollInterval);
            
        } catch (error) {
            console.error('❌ OCR 상태 폴링 오류:', error);
            setTimeout(poll, pollInterval);
        }
    };
    
    // 첫 번째 폴링 시작
    poll();
}

// 로그에서 파일명만 간단하게 추출하는 함수
function extractFileName(logLine) {
    // 다양한 패턴으로 파일명 추출 시도
    const patterns = [
        /(\d+\.pdf)/g,                    // 3.pdf
        /'(.+\.pdf)'/g,                   // '3.pdf'
        /===== (.+?) /g,                  // ===== 3.pdf 처리...
        /\[.+?\] (.+\.pdf)/g              // [3/5] 3.pdf
    ];
    
    for (const pattern of patterns) {
        const matches = [...logLine.matchAll(pattern)];
        if (matches.length > 0) {
            const fileName = matches[matches.length - 1][1]; // 마지막 매치
            console.log(`📄 파일명 추출: ${fileName} from: ${logLine}`);
            return fileName;
        }
    }
    
    return null;
}

// 일반 작업 상태 폴링 (마스킹용)
async function pollJobStatus(jobId, stepNumber, onComplete) {
    const pollInterval = setInterval(async () => {
        try {
            const status = await APIClient.getJobStatus(jobId);
            if (!status) return;
            
            if (stepNumber === 2) {
                UIController.updateProgress('maskingProgress', status.progress);
            }
            
            if (status.message) {
                UIController.showStepMessage(stepNumber, status.message, 'info');
            }
            
            if (status.status === 'completed') {
                clearInterval(pollInterval);
                
                if (status.result) {
                    if (stepNumber === 2) {
                        maskedFiles = status.result.processed_files || [];
                        fileMappingData = status.result.file_mapping || [];
                    }
                }
                
                UIController.updateProgress(stepNumber === 2 ? 'maskingProgress' : 'ocrProgress', 100);
                onComplete();
                
            } else if (status.status === 'failed') {
                clearInterval(pollInterval);
                UIController.showStepMessage(stepNumber, `작업 실패: ${status.error}`, 'error');
                
                if (stepNumber === 2) {
                    startMaskingBtn.disabled = false;
                }
            }
            
        } catch (error) {
            console.error('상태 폴링 오류:', error);
        }
    }, 2000);
}

// 서버 연결 확인
async function checkServerConnection() {
    try {
        const health = await APIClient.checkHealth();
        UIController.showStepMessage(1, '✅ 서버 연결이 확인되었습니다.', 'success');
        
        // 폴더 상태 표시
        if (health.folders) {
            const folderInfo = document.getElementById('folderInfo');
            folderInfo.innerHTML = `
                📁 pdfs 폴더: ${health.folders.pdfs.exists ? `${health.folders.pdfs.count}개 파일` : '없음'}<br>
                📁 masked-pdfs 폴더: ${health.folders.masked_pdfs.exists ? `${health.folders.masked_pdfs.count}개 파일` : '없음'}
            `;
        }
    } catch (error) {
        UIController.showStepMessage(1, '❌ 서버에 연결할 수 없습니다. Flask 서버가 실행 중인지 확인하세요.', 'error');
    }
}

// 이벤트 리스너 초기화
function initializeEventListeners() {
    scanFolderBtn.addEventListener('click', handleFolderScan);
    startMaskingBtn.addEventListener('click', handleMasking);
    startOCRBtn.addEventListener('click', handleOCR);
    generateExcelBtn.addEventListener('click', handleExcelGeneration);

    // 다운로드 버튼들
    document.getElementById('downloadMaskedBtn').addEventListener('click', downloadMaskedFiles);
    document.getElementById('downloadExcelBtn').addEventListener('click', downloadExcel);
    document.getElementById('downloadMappingBtn').addEventListener('click', downloadMapping);
    
    // Step 4 바로 아래 엑셀 다운로드 버튼
    document.getElementById('downloadExcelDirectBtn').addEventListener('click', downloadExcel);
}

// 초기화
document.addEventListener('DOMContentLoaded', function() {
    // 첫 번째 스텝 활성화
    UIController.activateStep(1);
    
    initializeEventListeners();
    checkServerConnection();
});