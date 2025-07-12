// 전역 변수
let scannedFiles = [];
let maskedFiles = [];
let personalInfoData = [];
let fileMappingData = [];
let currentJobId = null;
let ocrJobId = null;
const API_BASE_URL = 'http://localhost:5000';

// DOM 요소
const scanFolderBtn = document.getElementById('scanFolderBtn');
const startMaskingBtn = document.getElementById('startMaskingBtn');
const startOCRBtn = document.getElementById('startOCRBtn');
const generateExcelBtn = document.getElementById('generateExcelBtn');
const resultsSection = document.getElementById('resultsSection');

// UI 컨트롤러
class UIController {
    static activateStep(stepNumber) {
        // 모든 스텝 비활성화
        for (let i = 1; i <= 4; i++) {
            const stepCard = document.getElementById(`step${i}`);
            const progressStep = document.getElementById(`progress-step-${i}`);
            
            stepCard.classList.remove('active');
            progressStep.classList.remove('active');
        }
        
        // 현재 스텝 활성화
        const currentStep = document.getElementById(`step${stepNumber}`);
        const currentProgress = document.getElementById(`progress-step-${stepNumber}`);
        
        currentStep.classList.add('active');
        currentProgress.classList.add('active');
        
        // 스크롤을 현재 스텝으로 이동
        currentStep.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    
    static completeStep(stepNumber) {
        const stepCard = document.getElementById(`step${stepNumber}`);
        const stepNumberEl = document.getElementById(`step${stepNumber}-number`);
        const progressStep = document.getElementById(`progress-step-${stepNumber}`);
        
        stepCard.classList.add('completed');
        stepCard.classList.remove('active');
        stepNumberEl.classList.add('completed');
        stepNumberEl.innerHTML = '✓';
        progressStep.classList.add('completed');
        progressStep.classList.remove('active');
        
        // 다음 스텝 활성화
        if (stepNumber < 4) {
            setTimeout(() => {
                this.activateStep(stepNumber + 1);
            }, 500);
        }
    }
    
    static updateProgress(elementId, percentage) {
        const progressBar = document.getElementById(elementId);
        progressBar.style.width = `${percentage}%`;
    }
    
    static showStepMessage(stepNumber, message, type) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `status-message status-${type}`;
        messageDiv.textContent = message;
        
        const messagesContainer = document.getElementById(`step${stepNumber}Messages`);
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.remove();
            }
        }, 5000);
    }
}

// OCR 로그 컨트롤러
class OCRLogController {
    static show() {
        const logContainer = document.getElementById('ocrLogContainer');
        logContainer.style.display = 'block';
        
        // 토글 버튼 이벤트
        const toggleBtn = document.getElementById('toggleLogBtn');
        const logContent = document.getElementById('ocrLogContent');
        
        toggleBtn.onclick = () => {
            if (logContent.style.display === 'none') {
                logContent.style.display = 'block';
                toggleBtn.textContent = '접기';
            } else {
                logContent.style.display = 'none';
                toggleBtn.textContent = '펼치기';
            }
        };
    }
    
    static hide() {
        const logContainer = document.getElementById('ocrLogContainer');
        logContainer.style.display = 'none';
    }
    
    static appendLog(message) {
        const logContent = document.getElementById('ocrLogContent');
        
        // 타임스탬프가 없는 메시지에만 추가
        let formattedMessage = message;
        if (!message.includes('[') || !message.includes(']')) {
            const timestamp = new Date().toLocaleTimeString();
            formattedMessage = `[${timestamp}] ${message}`;
        }
        
        // 기존 내용에 새 줄 추가
        if (logContent.textContent) {
            logContent.textContent += '\n' + formattedMessage;
        } else {
            logContent.textContent = formattedMessage;
        }
        
        // 자동 스크롤
        logContent.scrollTop = logContent.scrollHeight;
        
        // 로그가 너무 길어지면 상위 줄 제거 (최대 500줄)
        const lines = logContent.textContent.split('\n');
        if (lines.length > 500) {
            logContent.textContent = lines.slice(-500).join('\n');
        }
    }
    
    static appendNewLog(message) {
        // 실시간 스트리밍용 - 타임스탬프가 이미 있음
        const logContent = document.getElementById('ocrLogContent');
        
        // 기존 내용에 새 줄 추가
        if (logContent.textContent) {
            logContent.textContent += '\n' + message;
        } else {
            logContent.textContent = message;
        }
        
        // 자동 스크롤
        logContent.scrollTop = logContent.scrollHeight;
        
        // 로그가 너무 길어지면 상위 줄 제거 (최대 500줄)
        const lines = logContent.textContent.split('\n');
        if (lines.length > 500) {
            logContent.textContent = lines.slice(-500).join('\n');
        }
    }
    
    static clearLog() {
        const logContent = document.getElementById('ocrLogContent');
        logContent.textContent = '';
    }
    
    static setLogContent(content) {
        const logContent = document.getElementById('ocrLogContent');
        logContent.textContent = content;
        logContent.scrollTop = logContent.scrollHeight;
    }
}

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
    UIController.showStepMessage(3, 'Gemini OCR 스크립트를 실행합니다...', 'info');
    
    // OCR 로그 표시
    OCRLogController.show();
    OCRLogController.clearLog();
    OCRLogController.appendLog('OCR 처리를 시작합니다...');

    try {
        const result = await APIClient.runOCR();
        
        if (result.success) {
            ocrJobId = result.job_id;
            UIController.showStepMessage(3, result.message, 'success');
            OCRLogController.appendLog(`작업 ID: ${result.job_id}`);
            
            pollJobStatus(result.job_id, 3, () => {
                UIController.completeStep(3);
                UIController.showStepMessage(3, 'OCR 처리가 완료되었습니다!', 'success');
                OCRLogController.appendLog('OCR 처리가 성공적으로 완료되었습니다.');
            });
            
        } else {
            throw new Error(result.error || 'OCR 처리 실패');
        }
        
    } catch (error) {
        UIController.showStepMessage(3, `OCR 처리 중 오류: ${error.message}`, 'error');
        OCRLogController.appendLog(`오류: ${error.message}`);
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

// 작업 상태 폴링 (OCR 로그 포함)
async function pollJobStatus(jobId, stepNumber, onComplete) {
    const pollInterval = setInterval(async () => {
        try {
            const status = await APIClient.getJobStatus(jobId);
            if (!status) return;
            
            if (stepNumber === 2) {
                UIController.updateProgress('maskingProgress', status.progress);
            } else if (stepNumber === 3) {
                UIController.updateProgress('ocrProgress', status.progress);
                
                // OCR 로그 업데이트
                if (status.message) {
                    OCRLogController.appendLog(status.message);
                }
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
                    } else if (stepNumber === 3 && status.result.output) {
                        // OCR 출력 로그 표시
                        OCRLogController.appendLog('=== OCR 스크립트 출력 ===');
                        OCRLogController.appendLog(status.result.output);
                    }
                }
                
                UIController.updateProgress(stepNumber === 2 ? 'maskingProgress' : 'ocrProgress', 100);
                onComplete();
                
            } else if (status.status === 'failed') {
                clearInterval(pollInterval);
                UIController.showStepMessage(stepNumber, `작업 실패: ${status.error}`, 'error');
                
                if (stepNumber === 3) {
                    OCRLogController.appendLog(`작업 실패: ${status.error}`);
                }
                
                if (stepNumber === 2) {
                    startMaskingBtn.disabled = false;
                } else if (stepNumber === 3) {
                    startOCRBtn.disabled = false;
                }
            }
            
        } catch (error) {
            console.error('상태 폴링 오류:', error);
        }
    }, 2000);
}

// 스캔된 파일 표시
function displayScannedFiles(result) {
    const folderInfo = document.getElementById('folderInfo');
    const filesList = document.getElementById('scannedFiles');
    
    // 폴더 정보 업데이트
    folderInfo.innerHTML = `
        📁 <strong>${result.folder}</strong><br>
        📄 파일 수: ${result.count}개<br>
        💾 총 크기: ${(result.total_size / 1024 / 1024).toFixed(2)} MB
    `;
    folderInfo.className = result.count > 0 ? 'folder-info' : 'folder-info empty';

    // 파일 목록 표시
    if (result.count > 0) {
        filesList.innerHTML = '';
        filesList.style.display = 'block';

        result.files.forEach((file, index) => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            fileItem.innerHTML = `
                <span>${index + 1}. ${file.filename}</span>
                <span>${(file.size / 1024 / 1024).toFixed(2)} MB</span>
            `;
            filesList.appendChild(fileItem);
        });
    }
}

function displayResults() {
    resultsSection.style.display = 'block';
    
    // 마스킹된 파일 목록
    const maskedList = document.getElementById('maskedFilesList');
    if (maskedFiles.length > 0) {
        maskedList.innerHTML = maskedFiles.map((file, index) => 
            `<div class="file-item">${file.masked_name} (${(file.size / 1024 / 1024).toFixed(2)} MB)</div>`
        ).join('');
    } else {
        maskedList.innerHTML = '<div class="file-item">마스킹된 파일 정보를 불러오는 중...</div>';
    }
    
    // 개인정보 테이블
    const personalTable = document.getElementById('personalInfoTable');
    personalTable.innerHTML = `
        <table class="preview-table">
            <thead>
                <tr>
                    <th>순서</th>
                    <th>이름</th>
                    <th>생년월일</th>
                </tr>
            </thead>
            <tbody>
                ${personalInfoData.map(item => `
                    <tr>
                        <td>${item.order}</td>
                        <td>${item.name}</td>
                        <td>${item.birth_date}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    
    // 파일 매핑 정보
    const mappingInfo = document.getElementById('fileMappingInfo');
    if (fileMappingData.length > 0) {
        mappingInfo.innerHTML = fileMappingData.map(item => 
            `<div class="file-item">${item.masked_name} ← ${item.original_name}</div>`
        ).join('');
    } else {
        mappingInfo.innerHTML = '<div class="file-item">매핑 정보를 불러오는 중...</div>';
    }
    
    document.getElementById('downloadMaskedBtn').disabled = false;
    document.getElementById('downloadExcelBtn').disabled = false;
    document.getElementById('downloadMappingBtn').disabled = false;
}

// 다운로드 함수들
async function downloadMaskedFiles() {
    try {
        UIController.showStepMessage(2, '마스킹된 파일을 다운로드하는 중...', 'info');
        
        const response = await fetch(`${API_BASE_URL}/download-masked`);
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `다운로드 실패: ${response.status}`);
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `masked_pdfs_${new Date().toISOString().split('T')[0]}.zip`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        
        UIController.showStepMessage(2, '마스킹된 파일이 다운로드되었습니다.', 'success');
        
    } catch (error) {
        UIController.showStepMessage(2, `다운로드 중 오류: ${error.message}`, 'error');
    }
}

function downloadExcel() {
    if (personalInfoData.length === 0) return;
    
    const excelData = personalInfoData.map(item => ({
        '순서': item.order,
        '이름': item.name,
        '생년월일': item.birth_date
    }));
    
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);
    
    const colWidths = [
        { wch: 10 },
        { wch: 20 },
        { wch: 15 }
    ];
    ws['!cols'] = colWidths;
    
    XLSX.utils.book_append_sheet(wb, ws, '파일목록');
    
    const fileName = `파일목록_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
    
    UIController.showStepMessage(4, '엑셀 파일이 다운로드되었습니다.', 'success');
}

function downloadMapping() {
    if (fileMappingData.length === 0) {
        UIController.showStepMessage(2, '매핑 정보가 없습니다.', 'error');
        return;
    }

    const mappingText = "번호 → 원본파일명\n" + "=".repeat(30) + "\n" +
        fileMappingData.map(item => `${item.masked_name} → ${item.original_name}`).join('\n');
    
    const blob = new Blob([mappingText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '파일매핑.txt';
    a.click();
    URL.revokeObjectURL(url);
    
    UIController.showStepMessage(2, '매핑 파일이 다운로드되었습니다.', 'success');
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

    // 다운로드 버튼
    document.getElementById('downloadMaskedBtn').addEventListener('click', downloadMaskedFiles);
    document.getElementById('downloadExcelBtn').addEventListener('click', downloadExcel);
    document.getElementById('downloadMappingBtn').addEventListener('click', downloadMapping);
}

// 초기화
document.addEventListener('DOMContentLoaded', function() {
    // 첫 번째 스텝 활성화
    UIController.activateStep(1);
    
    initializeEventListeners();
    checkServerConnection();
});