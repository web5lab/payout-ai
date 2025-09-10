// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./Offering.sol";
import "./interfaces/IInvestmentManager.sol"; // Import the interface
import "./Escrow.sol"; // Import Escrow to interact with it

contract InvestmentManager is Ownable, IInvestmentManager {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    address public escrowContract;
    mapping(address => bool) public kybValidators; // Multiple addresses that can sign KYB validations
    uint256 public kybValidatorCount; // Track number of active validators
    mapping(address => bool) public refundsEnabledForOffering;
    mapping(bytes32 => bool) public usedSignatures; // Track used signatures to prevent replay

    event InvestmentRouted(
        address indexed investor,
        address indexed offeringAddress,
        address indexed paymentToken,
        uint256 paidAmount,
        uint256 tokensReceived
    );

    event TokensClaimed(
        address indexed investor,
        address indexed offeringAddress,
        uint256 amount
    );

    event RefundClaimed(
        // New event for subgraph
        address indexed investor,
        address indexed offeringAddress,
        address indexed token,
        uint256 amount
    );

    event refundEnabled(address indexed offeringAddress);

    event KYBValidatorUpdated(
        address indexed oldValidator,
        address indexed newValidator
    );
    event KYBValidatorAdded(address indexed validator);
    event KYBValidatorRemoved(address indexed validator);
    event KYBValidatedInvestment(
        address indexed investor,
        address indexed offeringAddress,
        address indexed paymentToken,
        uint256 paidAmount,
        uint256 tokensReceived,
        bytes32 signatureHash
    );

    constructor() Ownable(msg.sender) {}

    function setEscrowContract(address _escrowContract) external onlyOwner {
        require(
            _escrowContract != address(0),
            "Invalid escrow contract address"
        );
        escrowContract = _escrowContract;
    }

    /**
     * @notice Add a KYB validator address that can sign wallet validations
     * @param _kybValidator Address of the KYB validator to add
     */
    function addKYBValidator(address _kybValidator) external onlyOwner {
        require(_kybValidator != address(0), "Invalid KYB validator address");
        require(!kybValidators[_kybValidator], "Validator already exists");

        kybValidators[_kybValidator] = true;
        kybValidatorCount++;
        emit KYBValidatorAdded(_kybValidator);
    }

    /**
     * @notice Remove a KYB validator address
     * @param _kybValidator Address of the KYB validator to remove
     */
    function removeKYBValidator(address _kybValidator) external onlyOwner {
        require(_kybValidator != address(0), "Invalid KYB validator address");
        require(kybValidators[_kybValidator], "Validator does not exist");
        require(kybValidatorCount > 1, "Cannot remove last validator");

        kybValidators[_kybValidator] = false;
        kybValidatorCount--;
        emit KYBValidatorRemoved(_kybValidator);
    }

    /**
     * @notice Set the initial KYB validator (for backward compatibility)
     * @param _kybValidator Address of the KYB validator (backend signer)
     */
    function setKYBValidator(address _kybValidator) external onlyOwner {
        require(_kybValidator != address(0), "Invalid KYB validator address");
        require(
            kybValidatorCount == 0,
            "Use addKYBValidator for additional validators"
        );

        kybValidators[_kybValidator] = true;
        kybValidatorCount++;
        emit KYBValidatorAdded(_kybValidator);
    }

    /**
     * @notice Verify KYB signature for a wallet
     * @param _wallet Wallet address to validate
     * @param _nonce Unique nonce to prevent replay attacks
     * @param _expiry Signature expiry timestamp
     * @param _signature Off-chain signature from KYB validator
     * @return isValid Whether the signature is valid and not expired
     */
    function verifyKYBSignature(
        address _wallet,
        uint256 _nonce,
        uint256 _expiry,
        bytes memory _signature
    ) public view returns (bool isValid) {
        require(kybValidatorCount > 0, "No KYB validators set");
        require(block.timestamp <= _expiry, "Signature expired");

        // Create message hash
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                "KYB_VALIDATION",
                _wallet,
                _nonce,
                _expiry,
                block.chainid,
                address(this)
            )
        );

        // Convert to Ethereum signed message hash
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();

        // Check if signature is already used
        if (usedSignatures[ethSignedMessageHash]) {
            return false;
        }

        // Verify signature
        address recoveredSigner = ethSignedMessageHash.recover(_signature);
        return kybValidators[recoveredSigner];
    }

    /**
     * @notice Route investment with KYB signature validation
     * @param _offeringAddress Address of the offering contract
     * @param _paymentToken Address of payment token (address(0) for ETH)
     * @param _paymentAmount Amount of payment tokens
     * @param _nonce Unique nonce for signature
     * @param _expiry Signature expiry timestamp
     * @param _signature Off-chain KYB validation signature
     */
    function routeInvestmentWithKYB(
        address _offeringAddress,
        address _paymentToken,
        uint256 _paymentAmount,
        uint256 _nonce,
        uint256 _expiry,
        bytes memory _signature
    ) external payable {
        // Verify KYB signature for each investment
        require(
            verifyKYBSignature(msg.sender, _nonce, _expiry, _signature),
            "Invalid KYB signature"
        );

        // Mark signature as used to prevent replay
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                "KYB_VALIDATION",
                msg.sender,
                _nonce,
                _expiry,
                block.chainid,
                address(this)
            )
        );
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        usedSignatures[ethSignedMessageHash] = true;

        // Proceed with normal investment routing
        Offering offering = Offering(payable(_offeringAddress));
        uint256 tokensReceivedAmount;

        if (_paymentToken == address(0)) {
            tokensReceivedAmount = offering.invest{value: msg.value}(
                _paymentToken,
                msg.sender,
                _paymentAmount
            );
        } else {
            tokensReceivedAmount = offering.invest(
                _paymentToken,
                msg.sender,
                _paymentAmount
            );
        }

        // Emit specialized event for KYB-validated investments
        emit KYBValidatedInvestment(
            msg.sender,
            _offeringAddress,
            _paymentToken,
            _paymentAmount,
            tokensReceivedAmount,
            keccak256(_signature)
        );
    }

    function notifyRefundsEnabled(address _offeringContract) external override {
        require(
            msg.sender == escrowContract,
            "Only Escrow contract can call this function"
        );
        refundsEnabledForOffering[_offeringContract] = true;
        emit refundEnabled(_offeringContract); // Re-emitting the existing event for consistency
    }

    function claimRefund(
        address _offeringContract,
        address _token
    ) external override {
        require(
            refundsEnabledForOffering[_offeringContract],
            "Refunds not enabled for this offering"
        );
        require(_offeringContract != address(0), "Invalid offering contract");
        require(
            _token != address(0) || _token == address(0),
            "Invalid token address"
        ); // Allow address(0) for ETH

        Escrow escrow = Escrow(payable(escrowContract));

        // Get the deposit amount and token from Escrow before calling refund
        Escrow.DepositInfo memory depositInfo = escrow.getDepositInfo(
            _offeringContract,
            msg.sender
        );
        require(depositInfo.amount > 0, "No deposit found for refund");
        require(depositInfo.token == _token, "Token mismatch for refund");

        // Call the refund function on the Escrow contract
        escrow.refund(_offeringContract, msg.sender);

        // Emit event for subgraph with the actual refunded amount and token
        emit RefundClaimed(
            msg.sender,
            _offeringContract,
            depositInfo.token,
            depositInfo.amount
        );
    }

    function routeInvestment(
        address _offeringAddress,
        address _paymentToken,
        uint256 _paymentAmount
    ) external payable {
        // Ensure the offering exists and is valid
        Offering offering = Offering(payable(_offeringAddress));

        uint256 tokensReceivedAmount;
        // If _paymentToken is address(0), it's a native ETH investment
        if (_paymentToken == address(0)) {
            tokensReceivedAmount = offering.invest{value: msg.value}(
                _paymentToken,
                msg.sender,
                _paymentAmount
            );
        } else {
            tokensReceivedAmount = offering.invest(
                _paymentToken,
                msg.sender,
                _paymentAmount
            );
        }

        // Emit event for subgraph
        emit InvestmentRouted(
            msg.sender,
            _offeringAddress,
            _paymentToken,
            _paymentAmount,
            tokensReceivedAmount
        );
    }

    function claimInvestmentTokens(address _offeringAddress) external {
        Offering offering = Offering(payable(_offeringAddress));
        uint256 claimedAmount = offering.claimTokens(msg.sender);
        emit TokensClaimed(msg.sender, _offeringAddress, claimedAmount);
    }

    /**
     * @notice Check if an address is a valid KYB validator
     * @param _validator Address to check
     * @return isValidator Whether the address is a valid KYB validator
     */
    function isKYBValidator(
        address _validator
    ) external view returns (bool isValidator) {
        return kybValidators[_validator];
    }

    /**
     * @notice Get the number of active KYB validators
     * @return count Number of active validators
     */
    function getKYBValidatorCount() external view returns (uint256 count) {
        return kybValidatorCount;
    }

    /**
     * @notice Check if a signature hash has been used
     * @param _signatureHash Hash of the signature to check
     * @return isUsed Whether the signature has been used
     */
    function isSignatureUsed(
        bytes32 _signatureHash
    ) external view returns (bool isUsed) {
        return usedSignatures[_signatureHash];
    }

    // Function to allow the owner to withdraw any accidentally sent ERC20 tokens
    function rescueERC20(
        address _token,
        uint256 _amount,
        address _to
    ) external onlyOwner {
        require(_token != address(0), "Invalid token address");
        require(_amount > 0, "Amount must be greater than 0");
        require(_to != address(0), "Invalid recipient address");
        IERC20(_token).transfer(_to, _amount);
    }

    // Function to allow the owner to withdraw any accidentally sent native currency
    function rescueNative(uint256 _amount, address _to) external onlyOwner {
        require(_amount > 0, "Amount must be greater than 0");
        require(_to != address(0), "Invalid recipient address");
        payable(_to).transfer(_amount);
    }

    receive() external payable {}
}
