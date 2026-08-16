pipeline {
    agent any

    stages {

       stage('install dependencies') {
			steps {
				sh '''  		
                echo "Installing dependencies..."	
                    npm install 
				''' 
			}   
		}   
    
       stage('Start App') {
			steps {
				sh '''
				 echo "Starting HostelNode App..."	
                 				 	
				'''
			}
		}

        stage('Verify') {
            steps {
                sh '''
                    sleep 15
                    curl -sf http://localhost:6060 && echo "✅ App is alive!" || echo "❌ App not responding"
                '''
            }
        }
    }

    post {
        success { echo "✅ Deployment successful 🚀" }
        failure { echo "❌ Deployment failed 💥" }
    }
}
