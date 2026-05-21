# FasalFlow: AI Field Intelligence for Syngenta

FasalFlow is an intelligent, responsive dashboard built for Syngenta field representatives and territory managers. By leveraging machine learning over historical synthetic retail data, FasalFlow shifts the paradigm from reactive store visits to proactive, data-driven territory management.

## Key Features

*   **Dynamic Prioritized Visit Planning**: Machine learning models score and rank the most critical retailer visits for any given day based on predicted conversion probability (AUC: 0.577) and recent interactions.
*   **Time-Travel Analytics**: Navigate through historical synthetic data weeks to see how AI recommendations adapt to changing crop stages, weather patterns, and inventory depletion.
*   **AI Explainability**: Every recommendation includes a clear "Why visit today?" section, providing the field rep with exact pitch recommendations and natural language explanations of the underlying data signals.
*   **Real-time Visit Filtering**: Log visits on the fly. The moment an outcome is synced, the retailer is filtered out of the day's queue, dynamically pulling the next highest-priority retailer into focus.
*   **Macro-Level Anomalies Feed**: A dedicated alerts stream highlighting regional trends (e.g., sudden district-wide stockouts or demand spikes) detected by the backend data pipeline.
*   **Enterprise Desktop UI**: A fully responsive dashboard featuring sleek sidebars, masonry grid layouts, and smooth animations powered by Framer Motion.

## Architecture Stack

The project is split into two primary layers:

### Backend (Python / FastAPI)
*   **Framework**: FastAPI serving REST endpoints (`/plan`, `/visit`, `/anomalies`, `/sync`).
*   **Data Processing**: Pandas for in-memory processing of the synthetic dataset (`features_master.parquet`, `visit_history.parquet`, `anomalies.parquet`).
*   **Machine Learning**: Scikit-Learn `RandomForestClassifier` trained on historical retail signals.
*   **Database**: SQLite (`outcomes.db`) for tracking user-submitted visit logs and outcomes.

### Frontend (Next.js / React)
*   **Framework**: Next.js (App Router) using React 18.
*   **Styling**: TailwindCSS with premium, modern aesthetics inspired by Shadcn/Aceternity UI.
*   **Icons & Animation**: Lucide React and Framer Motion for micro-interactions and smooth layout transitions.
*   **API Client**: Axios for backend communication.

## How to Run Locally

### 1. Start the Backend
```bash
cd backend
# Create and activate a virtual environment (optional but recommended)
python -m venv venv
.\venv\Scripts\activate  # Windows

# Install requirements
pip install -r requirements.txt

# Run the FastAPI server
uvicorn src.api.main:app --port 8080 --reload
```
*The backend will be available at http://localhost:8080*

### 2. Start the Frontend
Open a new terminal window:
```bash
cd frontend

# Install dependencies
npm install

# Run the Next.js development server
npm run dev
```
*The frontend dashboard will be available at http://localhost:3000*

## Project Structure

```text
FasalFlow/
├── backend/                  # Python FastAPI Backend
│   ├── data/                 # Synthetic parquet datasets & SQLite DB
│   ├── src/
│   │   ├── api/              # FastAPI routers and main.py
│   │   ├── models/           # Scikit-Learn trained models (.pkl)
│   │   └── scoring/          # Business logic and ML inference wrappers
│   └── requirements.txt
├── frontend/                 # Next.js Frontend
│   ├── src/
│   │   ├── app/              # Next.js App Router pages (plan, visit, sync, etc.)
│   │   ├── components/       # Reusable UI components (Navigation, PlanList, etc.)
│   │   └── lib/              # API clients and utilities
│   ├── tailwind.config.ts
│   └── package.json
└── README.md
└── Submission.docx
└── SUBMISSION.md
└── .gitignore
```


## Contributors

* Sagandeep Kaur
* Kaushal Vaid
* Prakhar Arora
* Pulkit Mangal
* Kshitij Maheshwari
* Vaibhwee
* Swati Singh
