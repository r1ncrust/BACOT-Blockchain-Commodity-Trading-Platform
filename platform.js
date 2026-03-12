// Main entry point for the Commodity Trading Platform
const { spawn } = require('child_process');
const path = require('path');

class CommodityTradingPlatform {
  constructor() {
    this.backendProcess = null;
    this.frontendProcess = null;
    this.hardhatProcess = null;
  }

  /**
   * Start the entire platform with all services
   */
  async start() {
    console.log('🚀 Starting Commodity Trading Platform...\n');
    
    try {
      // Start Hardhat node first
      await this.startHardhatNode();
      
      // Start backend server
      await this.startBackend();
      
      // Start frontend
      await this.startFrontend();
      
      console.log('\n✅ All services started successfully!');
      console.log('🌐 Frontend: http://localhost:3000');
      console.log('📡 Backend: http://localhost:3001');
      console.log('🔗 Hardhat: http://localhost:8545');
      
    } catch (error) {
      console.error('❌ Error starting platform:', error.message);
      this.cleanup();
      process.exit(1);
    }
  }

  /**
   * Start Hardhat local blockchain
   */
  async startHardhatNode() {
    console.log('📦 Starting Hardhat local blockchain...');
    
    return new Promise((resolve, reject) => {
      this.hardhatProcess = spawn('npx', ['hardhat', 'node'], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.hardhatProcess.stdout.on('data', (data) => {
        const output = data.toString();
        if (output.includes('Started HTTP and WebSocket JSON-RPC server')) {
          console.log('✅ Hardhat node started');
          resolve();
        }
        console.log(`Hardhat: ${output}`);
      });

      this.hardhatProcess.stderr.on('data', (data) => {
        console.error(`Hardhat Error: ${data.toString()}`);
        reject(new Error(data.toString()));
      });

      this.hardhatProcess.on('close', (code) => {
        if (code !== 0) {
          console.error(`Hardhat process exited with code ${code}`);
          reject(new Error(`Hardhat failed with exit code ${code}`));
        }
      });

      // Wait a bit for the process to start
      setTimeout(resolve, 3000);
    });
  }

  /**
   * Start backend server
   */
  async startBackend() {
    console.log('🔧 Starting backend server...');
    
    return new Promise((resolve, reject) => {
      this.backendProcess = spawn('node', ['server.js'], {
        cwd: path.join(__dirname, 'backend'),
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.backendProcess.stdout.on('data', (data) => {
        const output = data.toString();
        if (output.includes('Backend server running on port')) {
          console.log('✅ Backend server started');
          resolve();
        }
        console.log(`Backend: ${output}`);
      });

      this.backendProcess.stderr.on('data', (data) => {
        console.error(`Backend Error: ${data.toString()}`);
      });

      this.backendProcess.on('close', (code) => {
        if (code !== 0) {
          console.error(`Backend process exited with code ${code}`);
        }
      });
    });
  }

  /**
   * Start frontend development server
   */
  async startFrontend() {
    console.log('🎨 Starting frontend development server...');
    
    return new Promise((resolve, reject) => {
      this.frontendProcess = spawn('npm', ['start'], {
        cwd: path.join(__dirname, 'frontend'),
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, BROWSER: 'none' } // Don't automatically open browser
      });

      this.frontendProcess.stdout.on('data', (data) => {
        const output = data.toString();
        if (output.includes('Local:') || output.includes('http://localhost:3000')) {
          console.log('✅ Frontend development server started');
          resolve();
        }
        console.log(`Frontend: ${output}`);
      });

      this.frontendProcess.stderr.on('data', (data) => {
        const errorOutput = data.toString();
        if (errorOutput.includes('EADDRINUSE')) {
          console.warn('⚠️  Frontend port 3000 might be in use');
        }
        console.error(`Frontend Error: ${errorOutput}`);
      });

      this.frontendProcess.on('close', (code) => {
        if (code !== 0) {
          console.error(`Frontend process exited with code ${code}`);
        }
      });
    });
  }

  /**
   * Deploy contracts to local network
   */
  async deployContracts() {
    console.log('🏗️  Deploying smart contracts...');
    
    return new Promise((resolve, reject) => {
      const deployProcess = spawn('npx', ['hardhat', 'run', 'scripts/deploy.ts', '--network', 'localhost'], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      deployProcess.stdout.on('data', (data) => {
        console.log(`Deploy: ${data.toString()}`);
      });

      deployProcess.stderr.on('data', (data) => {
        console.error(`Deploy Error: ${data.toString()}`);
      });

      deployProcess.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Contracts deployed successfully');
          resolve();
        } else {
          console.error(`❌ Contract deployment failed with code ${code}`);
          reject(new Error(`Deployment failed with exit code ${code}`));
        }
      });
    });
  }

  /**
   * Run tests
   */
  async runTests() {
    console.log('🧪 Running tests...');
    
    return new Promise((resolve, reject) => {
      const testProcess = spawn('npx', ['hardhat', 'test'], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      testProcess.stdout.on('data', (data) => {
        console.log(data.toString());
      });

      testProcess.stderr.on('data', (data) => {
        console.error(data.toString());
      });

      testProcess.on('close', (code) => {
        if (code === 0) {
          console.log('✅ All tests passed');
          resolve();
        } else {
          console.error(`❌ Tests failed with code ${code}`);
          reject(new Error(`Tests failed with exit code ${code}`));
        }
      });
    });
  }

  /**
   * Cleanup all processes
   */
  cleanup() {
    console.log('\n🧹 Cleaning up...');
    
    if (this.hardhatProcess) {
      this.hardhatProcess.kill();
    }
    
    if (this.backendProcess) {
      this.backendProcess.kill();
    }
    
    if (this.frontendProcess) {
      this.frontendProcess.kill();
    }
  }

  /**
   * Handle graceful shutdown
   */
  setupGracefulShutdown() {
    process.on('SIGINT', () => {
      console.log('\n\n🛑 Received SIGINT, shutting down gracefully...');
      this.cleanup();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('\n\n🛑 Received SIGTERM, shutting down gracefully...');
      this.cleanup();
      process.exit(0);
    });

    process.on('uncaughtException', (err) => {
      console.error('❌ Uncaught Exception:', err);
      this.cleanup();
      process.exit(1);
    });
  }
}

/**
 * Command line interface
 */
async function main() {
  const platform = new CommodityTradingPlatform();
  platform.setupGracefulShutdown();

  const args = process.argv.slice(2);

  try {
    if (args.includes('--test') || args.includes('-t')) {
      await platform.runTests();
    } else if (args.includes('--deploy') || args.includes('-d')) {
      await platform.startHardhatNode();
      await platform.deployContracts();
    } else if (args.includes('--help') || args.includes('-h')) {
      console.log(`
Commodity Trading Platform CLI

Usage:
  node index.js [options]

Options:
  --start, -s     Start the entire platform (default)
  --test, -t      Run tests
  --deploy, -d    Deploy contracts to local network
  --help, -h      Show help

Examples:
  node index.js           # Start the platform
  node index.js --test    # Run tests
  node index.js --deploy  # Deploy contracts
      `);
    } else {
      // Default: start the platform
      await platform.start();
    }
  } catch (error) {
    console.error('❌ Platform startup failed:', error.message);
    process.exit(1);
  }
}

// Only run if this file is executed directly
if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = CommodityTradingPlatform;