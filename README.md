# Offering with Factory Contract Project

This project implements a decentralized fundraising platform using Solidity smart contracts and Hardhat. It allows for the creation of "Offerings" where projects can sell their tokens to investors in a secure and transparent manner.

## Core Concepts

The system is built around a few key smart contracts:

*   **`OfferingFactory.sol`**: This is the main entry point for creating new offerings. It's a factory contract that deploys and manages individual `Offering` contracts.
*   **`Offering.sol`**: This contract represents a single fundraising offering. It defines the terms of the sale, such as the token being sold, the price, investment limits, and sale duration.
*   **`Escrow.sol`**: This contract holds the funds raised during an offering. It ensures that funds are handled securely and can be refunded to investors if the offering is canceled.
*   **`WrapedToken.sol`**: This contract is used when an offering has an APY (Annual Percentage Yield) feature. It wraps the sale token to provide yield to investors.

### Flow Breakdown:

1.  **Project Owner Creates Offering**: A project owner uses the `OfferingFactory` to create a new `Offering` contract. They define all the parameters of the sale.
2.  **Investor Invests**: An investor sends funds (either native currency like Lumia, or a whitelisted ERC20 token) to the `Offering` contract's `invest` function.
3.  **Funds Secured in Escrow**: The `Offering` contract forwards the investor's funds to the `Escrow` contract for safekeeping.
4.  **Token Distribution**:
    *   **Auto-Transfer**: If the offering is configured for auto-transfer, the corresponding amount of `saleToken` is sent to the investor immediately. If APY is enabled, a `WrappedToken` is minted for the investor instead.
    *   **Manual Claim**: If auto-transfer is disabled, the investor's tokens are held in the `Offering` contract. The investor must call the `claimTokens` function after the `maturityDate` to receive their tokens.
5.  **Refunds**: If the offering is canceled, the project owner can enable refunds on the `Escrow` contract. Investors can then call the `refund` function to get their initial investment back.

## Key Features

*   **Factory Pattern**: Easily deploy multiple, isolated offering contracts.
*   **Flexible Payments**: Accept both native currency and any whitelisted ERC20 token.
*   **USD Pegging**: Investments and fundraising goals are pegged to USD using API3 oracles, providing stability against crypto volatility.
*   **Whitelisting**: Control which ERC20 tokens are accepted for payment.
*   **Role-Based Access Control**: Securely manage contract functions with `DEFAULT_ADMIN_ROLE` and `TOKEN_OWNER_ROLE`.
*   **Pausable**: The admin can pause the contract in case of emergencies.
*   **APY/Staking**: Optional feature to provide yield on invested tokens through a `WrappedToken`.
*   **Secure Escrow**: Protects investor funds.
*   **Re-entrancy Guard**: Protects against common re-entrancy attacks.

## Hardhat Tasks

This project is set up with Hardhat. Here are some useful commands:

*   `npx hardhat help`: Display help information.
*   `npx hardhat test`: Run the test suite.
*   `npx hardhat node`: Start a local Hardhat network.
*   `npx hardhat compile`: Compile the smart contracts.
*   `npx hardhat clean`: Clear the cache and delete artifacts.
*   `npx hardhat flatten > ./contracts/Flattened/complete_flattened.sol`: Flatten the contracts into a single file.

### Smart Contract Audit with Slither

To audit the smart contracts using Slither:

1.  **Install Slither**: Slither is a static analysis framework for Solidity. It's a Python tool, so it's recommended to install it in a virtual environment.
    ```bash
    python3 -m venv .venv
    source .venv/bin/activate
    pip install slither-analyzer
    ```

2.  **Compile Contracts**: Ensure your contracts are compiled using Hardhat to resolve all dependencies and generate artifacts.
    ```bash
    npx hardhat clean
    npx hardhat compile
    ```

3.  **Run Slither**: Navigate to the root of the project and run Slither on the entire project directory. Slither will automatically detect the Hardhat project and use its compilation artifacts.
    ```bash
    source .venv/bin/activate
    slither .
    ```

### Deployment and Verification

To deploy the `OfferingFactory` contract:

```shell
# Deploy to a testnet (e.g., Lumia Testnet)
npx hardhat ignition deploy ignition/modules/FullDeploymentModule.js --network lumiaTestnet --verify

# Deploy to mainnet and verify
npx hardhat ignition deploy ignition/modules/FullDeploymentModule.js --network lumiaMainnet --verify
```

To verify a contract manually:

```shell
npx hardhat verify --network <NETWORK> <CONTRACT_ADDRESS> --constructor-args ignition/parameters/verifyOfferingParameters.js
```

### Local Simulation

To run a local simulation of the investment flow:

1.  Start a local Hardhat node:
    ```shell
    npx hardhat node
    ```
2.  Run the simulation script:
    ```shell
    npx hardhat run scripts/simulation.js --network localhost
    ```

### Payout Flow Simulation

To run a dedicated simulation of the wrapped token payout system:

1.  Start a local Hardhat node (if not already running):
    ```shell
    npx hardhat node
    ```
2.  Run the payout flow simulation script:
    ```shell
    npx hardhat run scripts/payout-flow-simulation.js --network localhost
    ```

This dedicated script tests comprehensive payout scenarios including:

*   **Basic Payout Flow**: Single investor investment, admin payout distribution, and user claims
*   **Multiple Investors Proportional Payout**: Multiple investors with different amounts receiving proportional payouts
*   **Multiple Payout Rounds**: Testing cumulative payout tracking across multiple distribution rounds
*   **Emergency Unlock with Payout History**: Users claiming payouts before using emergency unlock feature
*   **Dynamic Balance Adjustments**: How payout distribution changes when some investors exit early

#### Key Features Demonstrated:

*   **Admin Payout Management**: `addPayoutFunds()` for distributing rewards to all wrapped token holders
*   **Proportional Distribution**: Payouts distributed based on wrapped token balance proportions
*   **Emergency Unlock Integration**: Early exit with penalty while preserving payout history
*   **Multiple Payout Rounds**: Cumulative payout tracking and claiming across multiple distributions
*   **Dynamic Rebalancing**: Payout adjustments when token supply changes due to burns

#### Running Both Simulations:

For comprehensive testing of the entire ecosystem:

```shell
# Run general offering simulation
npx hardhat run scripts/simulation.js --network localhost

# Run dedicated payout flow simulation
npx hardhat run scripts/payout-flow-simulation.js --network localhost
```

The payout flow simulation provides deep testing of the wrapped token payout mechanism and demonstrates how the system handles complex scenarios with multiple investors, multiple payout rounds, and emergency unlocks.