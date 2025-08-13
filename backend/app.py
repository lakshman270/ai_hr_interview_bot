import os
import requests
import json
from flask import Flask, request, jsonify, render_template
from dotenv import load_dotenv
import google.generativeai as genai
from flask_cors import CORS
from sqlalchemy import desc
from flask_migrate import Migrate
from database import db, Interview, JobDescription, Activity
from datetime import datetime, timedelta

# --- 1. INITIALIZATION & CONFIG ---
load_dotenv()
app = Flask(__name__, template_folder='../frontend', static_folder='../frontend')
CORS(app)
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URI', 'sqlite:///interviews.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db.init_app(app)
migrate = Migrate(app, db)

# --- API KEYS & MODELS ---
VAPI_API_KEY, VAPI_PHONE_NUMBER_ID, GEMINI_API_KEY = os.getenv('VAPI_API_KEY'), os.getenv('VAPI_PHONE_NUMBER_ID'), os.getenv('GEMINI_API_KEY')
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    gemini_model = genai.GenerativeModel('gemini-1.5-pro-latest')
else:
    print("ERROR: GEMINI_API_KEY not found."); gemini_model = None

# --- HELPER FUNCTIONS ---
def log_activity(message):
    with app.app_context():
        activity = Activity(message=message)
        db.session.add(activity)
        db.session.commit()

def extract_text_from_pdf(pdf_file):
    try:
        import PyPDF2, io
        text = "".join(page.extract_text() or "" for page in PyPDF2.PdfReader(io.BytesIO(pdf_file.read())).pages)
        return text
    except Exception as e:
        print(f"Error reading PDF: {e}"); return None

def analyze_resume_with_ai(job_description, resume_text):
    if not gemini_model or not resume_text: return None
    prompt = f"You are an expert ATS. Analyze the resume against the JD and return ONLY a JSON object with: candidate_name, phone_number (or N/A), match_score (0-100), match_reason (1 sentence), and skills_to_assess (comma-separated string). \nJD:\n{job_description}\n\nRESUME:\n{resume_text}"
    try:
        response = gemini_model.generate_content(prompt)
        return json.loads(response.text.strip().replace('```json', '').replace('```', ''))
    except Exception as e:
        print(f"Error during AI resume analysis: {e}"); return None

# --- 3. FRONTEND SERVING & DASHBOARD API ---
@app.route('/')
@app.route('/interviews')
@app.route('/talent-pool')
def index():
    return render_template('index.html')

@app.route('/api/dashboard-data', methods=['GET'])
def get_dashboard_data():
    try:
        pending_count = Interview.query.filter_by(status='pending').count()
        completed_count = Interview.query.filter_by(status='completed').count()
        in_progress_count = Interview.query.filter(Interview.status.in_(['calling', 'analyzing'])).count()
        
        stats = {
            "total_shortlisted": pending_count + completed_count + in_progress_count,
            "completed_count": completed_count,
            "awaiting_call_count": pending_count,
            "in_progress_count": in_progress_count
        }
        up_next = Interview.query.filter_by(status='completed').order_by(desc(Interview.id)).limit(5).all()
        activities = Activity.query.order_by(desc(Activity.timestamp)).limit(10).all()

        return jsonify({ "stats": stats, "up_next": [i.to_dict() for i in up_next], "activities": [a.to_dict() for a in activities] })
    except Exception as e:
        print(f"Error fetching dashboard data: {e}"); return jsonify({"error": "Could not fetch dashboard data"}), 500

# --- 4. CORE API ROUTES ---
@app.route('/api/analyze-resumes', methods=['POST'])
def analyze_resumes():
    if 'job_description' not in request.form or 'resumes' not in request.files:
        return jsonify({"error": "Job description and resume files are required."}), 400
    job_description = request.form['job_description']
    resume_files = request.files.getlist('resumes')
    analysis_results = []

    if request.form.get('save_jd') == 'true' and 'jd_title' in request.form:
        jd_title = request.form['jd_title']
        if jd_title and not JobDescription.query.filter_by(title=jd_title).first():
            db.session.add(JobDescription(title=jd_title, description=job_description))
            db.session.commit()

    for resume_file in resume_files:
        resume_text = extract_text_from_pdf(resume_file)
        if resume_text:
            analysis = analyze_resume_with_ai(job_description, resume_text)
            if analysis: analysis_results.append(analysis)
    
    log_activity(f"Analyzed {len(analysis_results)} new resumes.")
    return jsonify({"results": sorted(analysis_results, key=lambda x: int(x.get('match_score', 0)), reverse=True)}), 200

@app.route('/api/interviews', methods=['GET'])
def list_interviews():
    try:
        # LOGIC FOR STUCK CALLS
        timeout_threshold = datetime.utcnow() - timedelta(minutes=20)
        stuck_interviews = Interview.query.filter(
            Interview.status.in_(['calling', 'analyzing']),
            Interview.last_status_change < timeout_threshold
        ).all()
        for interview in stuck_interviews:
            interview.status = 'failed'
            log_activity(f"Call with {interview.candidate_name} timed out.")
        if stuck_interviews:
            db.session.commit()

        page, per_page = request.args.get('page', 1, type=int), request.args.get('per_page', 8, type=int)
        search_term, status_filter = request.args.get('search', '', type=str), request.args.get('status', 'all', type=str)
        query = Interview.query.filter(Interview.status != 'error')
        if search_term: query = query.filter(Interview.candidate_name.ilike(f'%{search_term}%'))
        if status_filter and status_filter != 'all':
            if status_filter == 'in_progress': query = query.filter(Interview.status.in_(['calling', 'analyzing']))
            else: query = query.filter(Interview.status == status_filter)
        pagination = query.order_by(desc(Interview.id)).paginate(page=page, per_page=per_page, error_out=False)
        return jsonify({'interviews': [i.to_dict() for i in pagination.items], 'total_pages': pagination.pages, 'current_page': pagination.page})
    except Exception as e:
        print(f"Error fetching interviews: {e}"); return jsonify({"error": "Could not fetch interviews"}), 500

@app.route('/api/talent-pool', methods=['GET'])
def get_talent_pool():
    try:
        page, per_page = request.args.get('page', 1, type=int), request.args.get('per_page', 15, type=int)
        search_term = request.args.get('search', '', type=str)
        query = Interview.query
        if search_term:
            search_filter = f'%{search_term}%'
            query = query.filter(db.or_(Interview.candidate_name.ilike(search_filter), Interview.skills_to_assess.ilike(search_filter)))
        pagination = query.order_by(desc(Interview.score.isnot(None)), desc(Interview.score)).paginate(page=page, per_page=per_page, error_out=False)
        return jsonify({'candidates': [i.to_dict() for i in pagination.items], 'total_pages': pagination.pages})
    except Exception as e:
        print(f"Error fetching talent pool: {e}"); return jsonify({"error": "Could not fetch talent pool"}), 500

@app.route('/api/interviews/<int:interview_id>', methods=['GET'])
def get_interview_details(interview_id):
    interview = db.session.get(Interview, interview_id)
    if not interview: return jsonify({"error": "Interview not found"}), 404
    return jsonify(interview.to_dict())

@app.route('/api/interviews', methods=['POST'])
def create_interview():
    data = request.json
    required = ['candidate_name', 'phone_number', 'job_position', 'job_description']
    if not all(field in data for field in required): return jsonify({"error": "Missing required fields."}), 400
    new_interview = Interview(candidate_name=data['candidate_name'], phone_number=data['phone_number'], job_position=data['job_position'], job_description=data['job_description'], skills_to_assess=data.get('skills_to_assess', ''))
    db.session.add(new_interview)
    db.session.commit()
    log_activity(f"New interview created for {data['candidate_name']}.")
    return jsonify(new_interview.to_dict()), 201
    
@app.route('/api/jds', methods=['GET'])
def get_jds():
    return jsonify([jd.to_dict() for jd in JobDescription.query.order_by(JobDescription.title).all()])

@app.route('/api/interviews/<int:interview_id>/start-call', methods=['POST'])
def start_interview_call(interview_id):
    interview = db.session.get(Interview, interview_id)
    if not interview: return jsonify({"error": "Interview not found"}), 404
    if interview.status != 'pending': return jsonify({"error": f"Cannot start call. Status: {interview.status}"}), 409
    interview_prompt = f"You are Eva, an AI hiring assistant. Conduct a screening for the '{interview.job_position}' role. Greet '{interview.candidate_name}' and ask 4-5 questions about these skills: '{interview.skills_to_assess}'. Ask one question at a time. Then, end the call."
    headers = {'Authorization': f'Bearer {VAPI_API_KEY}'}
    payload = {'phoneNumberId': VAPI_PHONE_NUMBER_ID, 'customer': {'number': interview.phone_number}, 'assistant': {'firstMessage': f"Hi {interview.candidate_name}, this is Eva with your screening interview for the {interview.job_position} role. Is now a good time?", 'model': { 'provider': 'google', 'model': 'gemini-1.5-flash', 'systemPrompt': interview_prompt }, 'voice': { 'provider': 'vapi', 'voiceId': 'Neha' }, 'recordingEnabled': True}, 'metadata': {'interview_id': interview.id}}
    try:
        requests.post('https://api.vapi.ai/call/phone', headers=headers, json=payload, timeout=10).raise_for_status()
        interview.status = 'calling'; db.session.commit()
        log_activity(f"AI call started with {interview.candidate_name}.")
        return jsonify(interview.to_dict()), 200
    except requests.exceptions.RequestException as e:
        error_details = f"Failed to start call: {e.response.text if e.response else str(e)}"; print(f"ERROR: {error_details}")
        interview.status = 'failed'; db.session.commit()
        return jsonify({"error": error_details}), 500

@app.route('/api/interviews/delete', methods=['DELETE'])
def delete_interviews():
    ids_to_delete = request.json.get('ids')
    if not ids_to_delete: return jsonify({"error": "Invalid request."}), 400
    try:
        Interview.query.filter(Interview.id.in_(ids_to_delete)).delete(synchronize_session=False)
        db.session.commit()
        log_activity(f"Deleted {len(ids_to_delete)} interviews.")
        return jsonify({"message": "Successfully deleted."}), 200
    except Exception as e:
        db.session.rollback(); return jsonify({"error": "An error occurred."}), 500

@app.route('/api/webhook', methods=['POST'])
def vapi_webhook():
    payload = request.json
    if payload.get('message', {}).get('type') not in ['call-end', 'end-of-call-report']: return jsonify({"status": "ignored"}), 200
    interview_id = payload.get('message', {}).get('call', {}).get('metadata', {}).get('interview_id')
    if not interview_id: return jsonify({"status": "ignored"}), 200
    interview = db.session.get(Interview, interview_id)
    if not interview: return jsonify({"status": "error", "reason": f"ID {interview_id} not found"}), 404
    message = payload['message']
    
    # Handle unsuccessful calls
    if message.get('endedReason') and message.get('endedReason') != 'hangup':
        interview.status = 'failed'
        interview.assessment = f"Call failed. Reason: {message.get('endedReason')}"
        db.session.commit()
        log_activity(f"Call with {interview.candidate_name} failed: {message.get('endedReason')}")
        return jsonify({"status": "received"}), 200

    interview.transcript = message.get('transcript'); interview.duration_in_seconds = int(message.get('durationSeconds') or 0); interview.recording_url = message.get('recordingUrl'); interview.status = 'analyzing'
    db.session.commit()
    analyze_transcript(interview)
    return jsonify({"status": "received"}), 200

def analyze_transcript(interview):
    if not gemini_model:
        interview.status = 'error'; interview.assessment = "Error: Gemini model not configured."; db.session.commit(); return
    analysis_prompt = f"""
    Analyze the interview transcript for the '{interview.job_position}' role, assessed on '{interview.skills_to_assess}'.
    Job Description: {interview.job_description}
    Transcript: {interview.transcript}
    ---
    Your Task: Generate a JSON object with this exact structure, scoring each category from 0 to 10.
    {{
      "assessment": "A brief, professional evaluation of the candidate's answers.",
      "score": "An overall score for the candidate from 0 to 100.",
      "recommendation": "One of: 'Strong Hire', 'Hire', 'Consider', 'No Hire'.",
      "comm_score": "Score for communication skills (clarity, professionalism) from 0 to 10.",
      "tech_score": "Score for technical knowledge based on their answers from 0 to 10.",
      "relevance_score": "Score for how relevant their experience is to the JD from 0 to 10."
    }}
    """
    try:
        response = gemini_model.generate_content(analysis_prompt)
        analysis = json.loads(response.text.strip().replace('```json', '').replace('```', ''))
        interview.assessment = analysis.get('assessment'); interview.score = int(analysis.get('score', 0)); interview.recommendation = analysis.get('recommendation'); interview.comm_score = int(analysis.get('comm_score', 0)); interview.tech_score = int(analysis.get('tech_score', 0)); interview.relevance_score = int(analysis.get('relevance_score', 0));
        interview.status = 'completed'
        log_activity(f"Analysis complete for {interview.candidate_name}.")
    except Exception as e:
        print(f"ERROR: Gemini analysis failed for interview {interview.id}: {e}")
        interview.status = 'error'; interview.assessment = f"Error during AI analysis: {e}"
    db.session.commit()

if __name__ == '__main__':
    app.run(debug=True, port=5000)